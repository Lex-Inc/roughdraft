import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { createServer as createHttpServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { extractRoughdraftReviewIndex } from "@roughdraft/rfm";
import express, { type Express, type Request, type Response } from "express";
import {
  hasNonLoopbackHost,
  ROUGHDRAFT_DEFAULT_PORT,
  ROUGHDRAFT_PUBLIC_HOST,
  resolveBindHosts,
} from "./network.js";
import { ReviewEventQueue } from "./review-events.js";
import { resolveUpdateStatus } from "./update-status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(__dirname, "../../app/dist");
const defaultServerRoot = path.resolve(__dirname, "../../..");

interface AssetPayload {
  filename?: string;
  mimeType?: string;
  dataBase64?: string;
}

interface DirectoryEntry {
  name: string;
  path: string;
}

interface DirectoryListing {
  path: string;
  parentPath: string | null;
  directories: DirectoryEntry[];
}

interface FileSystemEntry {
  name: string;
  path: string;
  kind: "directory" | "file";
}

interface FileSystemListing {
  path: string;
  displayPath: string;
  parentPath: string | null;
  directories: FileSystemEntry[];
  files: FileSystemEntry[];
}

interface ProjectTreeListing {
  paths: string[];
}

interface CreateAppOptions {
  port?: number;
  projectDir?: string;
  serverRoot?: string;
  homeDir?: string;
  staticDirPath?: string;
  packageJsonPath?: string;
  fetchImpl?: typeof fetch;
  packageName?: string;
  remoteDocumentToken?: string;
}

interface CreateAppResult {
  app: Express;
  port: number;
}

interface OpenRequestClient {
  id: number;
  path: string | null;
  response: Response;
}

interface OpenRequestPayload {
  path?: string;
  url?: string;
}

interface RemoteSession {
  id: string;
  originPath: string;
  content: string;
  version: string;
  saveClient: Response | null;
  viewers: Set<Response>;
  disconnectedAt: number | null;
}

interface RemoteDocumentRegisterPayload {
  sessionId?: string;
  originPath?: string;
  content?: string;
}

interface RemoteDocumentSavePayload {
  content?: string;
  expectedVersion?: string;
}

interface VoiceSelectionPayload {
  from?: number;
  to?: number;
  selectedText?: string;
}

interface VoiceProcessPayload {
  path?: string;
  projectPath?: string;
  utterance?: string;
  selection?: VoiceSelectionPayload;
}

type VoiceActionType =
  | "comment"
  | "suggestion_addition"
  | "suggestion_deletion"
  | "suggestion_substitution";

interface VoiceActionResult {
  action: VoiceActionType;
  content: string;
  replacementText?: string;
  confidence: number;
  uncertain?: boolean;
}

function hasExplicitEditIntent(utterance: string): boolean {
  const normalized = utterance.toLowerCase();
  return /\b(delete|remove|replace|rewrite|reword|change|add|insert|move|cut|shorten|expand|merge|split|fix)\b/.test(
    normalized,
  );
}

function shouldForceComment(utterance: string): boolean {
  const normalized = utterance.toLowerCase();
  if (normalized.includes("?")) return true;
  if (
    /^(what|why|how|where|when|who|can|could|would|should|is|are|do|does|did)\b/.test(
      normalized,
    )
  ) {
    return true;
  }
  return false;
}

function coerceVoiceActionResult(
  utterance: string,
  result: VoiceActionResult,
): VoiceActionResult {
  if (result.action === "comment") return result;
  if (hasExplicitEditIntent(utterance) && !shouldForceComment(utterance)) {
    return result;
  }
  return {
    action: "comment",
    content: utterance,
    confidence: Math.min(result.confidence, 0.85),
    uncertain: result.uncertain ?? false,
  };
}

const REMOTE_SESSION_TTL_MS = 5 * 60 * 1000;
const REMOTE_SESSION_SWEEP_INTERVAL_MS = 60 * 1000;
const REMOTE_SESSION_KEEPALIVE_MS = 15 * 1000;

let nextOpenRequestClientId = 1;

const ROUGHDRAFT_OPENROUTER_API_KEY_ENV = "ROUGHDRAFT_OPENROUTER_API_KEY";
const ROUGHDRAFT_LLM_MODEL_ENV = "ROUGHDRAFT_LLM_MODEL";
const DEFAULT_VOICE_MODEL = "openai/gpt-4o-mini";
const ROUGHDRAFT_VOICE_MODEL_DIR_ENV = "ROUGHDRAFT_VOICE_MODEL_DIR";
const ROUGHDRAFT_VOICE_TRANSCRIBE_COMMAND_ENV =
  "ROUGHDRAFT_VOICE_TRANSCRIBE_COMMAND";
const execFileAsync = promisify(execFile);

interface VoiceTranscriptionSession {
  id: string;
  chunks: Buffer[];
  mimeType: string;
  createdAt: number;
}

function logVoice(event: string, data: Record<string, unknown> = {}): void {
  const payload = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };
  console.log(`[voice] ${JSON.stringify(payload)}`);
}

function summarizeApiKey(
  value: string | undefined,
): { present: boolean; prefix: string | null; length: number } {
  const trimmed = value?.trim() ?? "";
  if (trimmed.length === 0) {
    return { present: false, prefix: null, length: 0 };
  }
  return {
    present: true,
    prefix: trimmed.slice(0, 12),
    length: trimmed.length,
  };
}

function remoteSessionVersion(content: string): string {
  const hash = crypto.createHash("sha256").update(content).digest("hex");
  return `${hash}:${crypto.randomUUID()}`;
}

function remoteSessionView(session: RemoteSession): {
  id: string;
  originPath: string;
  content: string;
  version: string;
} {
  return {
    id: session.id,
    originPath: session.originPath,
    content: session.content,
    version: session.version,
  };
}

function writeRemoteSessionEvent(
  response: Response,
  event: string,
  data: unknown,
): void {
  response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function listMdFiles(projectDir: string): string[] {
  try {
    return fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

function titleFromContent(content: string, fallback: string): string {
  const firstLine = content.split("\n")[0] || "";
  return firstLine.replace(/^#*\s*/, "").trim() || fallback;
}

function fileVersionFromContent(
  stats: fs.Stats,
  content: string | Buffer,
): string {
  const contentHash = crypto.createHash("sha256").update(content).digest("hex");
  return `${stats.mtimeMs}:${stats.size}:${contentHash}`;
}

function fileVersionFromFile(filePath: string): string {
  const content = fs.readFileSync(filePath);
  const stats = fs.statSync(filePath);
  return fileVersionFromContent(stats, content);
}

function markdownPageFromFile(
  relativePath: string,
  absolutePath: string,
): {
  id: string;
  title: string;
  content: string;
  version: string;
} {
  const content = fs.readFileSync(absolutePath, "utf-8");
  const stats = fs.statSync(absolutePath);
  const fallbackTitle = path.basename(relativePath, ".md");

  return {
    id: pageIdFromRelativePath(relativePath),
    title: titleFromContent(content, fallbackTitle),
    content,
    version: fileVersionFromContent(stats, content),
  };
}

function pageIdFromRelativePath(relativePath: string): string {
  return relativePath.replace(/\.md$/i, "").split(path.sep).join("/");
}

function nextUntitledId(projectDir: string): string {
  const existing = listMdFiles(projectDir);
  let i = 1;
  while (existing.includes(`untitled-${i}`)) i++;
  return `untitled-${i}`;
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function ensureProjectPath(
  projectDir: string,
  relativePath: string,
): string | null {
  const normalized = relativePath.replace(/^\.?\//, "");
  const absolute = path.resolve(projectDir, normalized);
  const relative = path.relative(projectDir, absolute);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }

  return absolute;
}

function pageFilePathFromId(projectDir: string, id: string): string | null {
  return ensureProjectPath(projectDir, `${id}.md`);
}

function nextAssetPath(projectDir: string, filename: string): string {
  const assetsDir = path.join(projectDir, ".roughdraft-assets");
  fs.mkdirSync(assetsDir, { recursive: true });

  const safeName = sanitizeFilename(filename);
  const extensionIndex = safeName.lastIndexOf(".");
  const basename =
    extensionIndex > 0 ? safeName.slice(0, extensionIndex) : safeName;
  const extension = extensionIndex > 0 ? safeName.slice(extensionIndex) : "";

  let counter = 0;
  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const relativePath = `.roughdraft-assets/${basename}${suffix}${extension}`;
    const absolutePath = path.join(projectDir, relativePath);
    if (!fs.existsSync(absolutePath)) {
      return relativePath;
    }
    counter += 1;
  }
}

function ensureDirectoryExists(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function isExistingDirectory(dir: string): boolean {
  try {
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

function listDirectories(dir: string): DirectoryListing {
  const entries = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      path: path.join(dir, entry.name),
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const parentPath = path.dirname(dir);

  return {
    path: dir,
    parentPath: parentPath === dir ? null : parentPath,
    directories: entries,
  };
}

function formatDisplayPath(targetPath: string, homeDir: string): string {
  const normalizedHome = path.resolve(homeDir);
  const normalizedTarget = path.resolve(targetPath);

  if (normalizedTarget === normalizedHome) {
    return "~";
  }

  const relativeToHome = path.relative(normalizedHome, normalizedTarget);
  if (!relativeToHome.startsWith("..") && !path.isAbsolute(relativeToHome)) {
    return `~/${relativeToHome.split(path.sep).join("/")}`;
  }

  return normalizedTarget;
}

function listFileSystem(dir: string, homeDir: string): FileSystemListing {
  const normalizedDir = path.resolve(dir);
  const normalizedHome = path.resolve(homeDir);

  let rawEntries: fs.Dirent[];
  try {
    rawEntries = fs.readdirSync(normalizedDir, { withFileTypes: true });
  } catch (error) {
    const errorCode = (error as NodeJS.ErrnoException).code;
    if (errorCode === "EACCES" || errorCode === "EPERM") {
      throw new Error("Directory is not readable.");
    }
    throw error;
  }

  const directories = rawEntries
    .filter((entry) => entry.isDirectory())
    .map<FileSystemEntry>((entry) => ({
      name: entry.name,
      path: path.join(normalizedDir, entry.name),
      kind: "directory",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  const files = rawEntries
    .filter(
      (entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".md"),
    )
    .map<FileSystemEntry>((entry) => ({
      name: entry.name,
      path: path.join(normalizedDir, entry.name),
      kind: "file",
    }))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  return {
    path: normalizedDir,
    displayPath: formatDisplayPath(normalizedDir, normalizedHome),
    parentPath:
      normalizedDir === normalizedHome ? null : path.dirname(normalizedDir),
    directories,
    files,
  };
}

function toCanonicalRelativePath(
  projectDir: string,
  absolutePath: string,
  isDirectory: boolean,
): string {
  const relativePath = path.relative(projectDir, absolutePath);
  const canonicalPath = relativePath.split(path.sep).join("/");
  return isDirectory ? `${canonicalPath}/` : canonicalPath;
}

function listProjectTree(projectDir: string): ProjectTreeListing {
  const paths: string[] = [];

  const visitDirectory = (dir: string) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .slice()
      .sort((left, right) => {
        if (left.isDirectory() !== right.isDirectory()) {
          return left.isDirectory() ? -1 : 1;
        }
        return left.name.localeCompare(right.name, undefined, {
          numeric: true,
        });
      });

    for (const entry of entries) {
      const absolutePath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        paths.push(toCanonicalRelativePath(projectDir, absolutePath, true));
        visitDirectory(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        paths.push(toCanonicalRelativePath(projectDir, absolutePath, false));
      }
    }
  };

  visitDirectory(projectDir);

  return { paths };
}

function normalizeVoiceActionCandidate(value: unknown): VoiceActionType | null {
  if (
    value === "comment" ||
    value === "suggestion_addition" ||
    value === "suggestion_deletion" ||
    value === "suggestion_substitution"
  ) {
    return value;
  }

  return null;
}

function parseVoiceActionResult(payload: unknown): VoiceActionResult | null {
  if (!payload || typeof payload !== "object") return null;
  const data = payload as {
    action?: unknown;
    content?: unknown;
    replacementText?: unknown;
    confidence?: unknown;
    uncertain?: unknown;
  };
  const action = normalizeVoiceActionCandidate(data.action);
  const content =
    typeof data.content === "string" ? data.content.trim() : undefined;

  if (!action || !content) return null;

  return {
    action,
    content,
    replacementText:
      typeof data.replacementText === "string" &&
      data.replacementText.trim().length > 0
        ? data.replacementText.trim()
        : undefined,
    confidence:
      typeof data.confidence === "number"
        ? Math.min(1, Math.max(0, data.confidence))
        : 0.5,
    uncertain: data.uncertain === true,
  };
}

async function inferVoiceActionWithOpenRouter(
  utterance: string,
  selectedText: string,
  fetchImpl: typeof fetch,
): Promise<VoiceActionResult> {
  const apiKey = process.env[ROUGHDRAFT_OPENROUTER_API_KEY_ENV];
  const model =
    process.env[ROUGHDRAFT_LLM_MODEL_ENV]?.trim() || DEFAULT_VOICE_MODEL;
  const keySummary = summarizeApiKey(apiKey);
  logVoice("inference.config", {
    apiKeyPresent: keySummary.present,
    apiKeyPrefix: keySummary.prefix,
    apiKeyLength: keySummary.length,
    model,
    utteranceChars: utterance.length,
    selectedTextChars: selectedText.length,
  });
  if (!apiKey || apiKey.trim().length === 0) {
    logVoice("inference.fallback.no_api_key", {
      envKey: ROUGHDRAFT_OPENROUTER_API_KEY_ENV,
    });
    return {
      action: "comment",
      content: utterance,
      confidence: 0.2,
      uncertain: true,
    };
  }

  const response = await fetchImpl(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You convert dictated review feedback into a single JSON object with keys: action, content, replacementText, confidence, uncertain. action must be one of comment|suggestion_addition|suggestion_deletion|suggestion_substitution. Default to action=comment unless the utterance is an explicit edit instruction (delete/remove/replace/add/rewrite/etc). Questions, reactions, uncertainty, or discussion should be comment.",
          },
          {
            role: "user",
            content: `Selected text:\n${selectedText}\n\nUtterance:\n${utterance}\n\nReturn only JSON.`,
          },
        ],
      }),
    },
  );

  logVoice("inference.http.response", {
    status: response.status,
    ok: response.ok,
  });
  if (!response.ok) {
    let errorBody = "";
    try {
      errorBody = await response.text();
    } catch {
      errorBody = "";
    }
    logVoice("inference.fallback.http_error", {
      status: response.status,
      bodyPreview: errorBody.slice(0, 500),
    });
    return {
      action: "comment",
      content: utterance,
      confidence: 0.2,
      uncertain: true,
    };
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string | null } }>;
  };
  const content = payload.choices?.[0]?.message?.content;
  if (typeof content !== "string" || content.trim().length === 0) {
    logVoice("inference.fallback.empty_content", {
      hasChoices: Array.isArray(payload.choices),
    });
    return {
      action: "comment",
      content: utterance,
      confidence: 0.2,
      uncertain: true,
    };
  }

  try {
    const parsed = JSON.parse(content);
    const parsedResult = parseVoiceActionResult(parsed);
    if (!parsedResult) {
      logVoice("inference.fallback.schema_mismatch", {
        contentPreview: content.slice(0, 500),
      });
    } else {
      logVoice("inference.result", {
        action: parsedResult.action,
        confidence: parsedResult.confidence,
        uncertain: parsedResult.uncertain === true,
      });
    }
    const resolved =
      parsedResult ?? {
        action: "comment",
        content: utterance,
        confidence: 0.2,
        uncertain: true,
      };
    const coerced = coerceVoiceActionResult(utterance, resolved);
    if (coerced.action !== resolved.action) {
      logVoice("inference.coerce_to_comment", {
        utterancePreview: utterance.slice(0, 120),
        originalAction: resolved.action,
        coercedAction: coerced.action,
      });
    }
    return coerced;
  } catch {
    logVoice("inference.fallback.json_parse_error", {
      contentPreview: content.slice(0, 500),
    });
    return {
      action: "comment",
      content: utterance,
      confidence: 0.2,
      uncertain: true,
    };
  }
}

function resolveVoiceModelPath(): string {
  const modelDir =
    process.env[ROUGHDRAFT_VOICE_MODEL_DIR_ENV]?.trim() ||
    path.join(
      os.homedir(),
      "Library/Application Support/com.prakashjoshipax.VoiceInk/WhisperModels",
    );
  return path.join(modelDir, "ggml-large-v3-turbo.bin");
}

function parseCommandTemplate(template: string): {
  command: string;
  args: string[];
} {
  const parts = template
    .split(" ")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  const command = parts.shift();
  if (!command) {
    throw new Error("voice transcribe command is empty");
  }
  return { command, args: parts };
}

async function transcribeLocalAudioFromBuffer(
  audioBuffer: Buffer,
): Promise<string> {
  const commandTemplate = process.env[ROUGHDRAFT_VOICE_TRANSCRIBE_COMMAND_ENV];
  if (!commandTemplate || commandTemplate.trim().length === 0) {
    logVoice("transcribe.skip.no_command", {
      envKey: ROUGHDRAFT_VOICE_TRANSCRIBE_COMMAND_ENV,
    });
    return "";
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "roughdraft-voice-"));
  const audioPath = path.join(tempDir, "audio.webm");
  const outputPath = path.join(tempDir, "transcript");
  fs.writeFileSync(audioPath, audioBuffer);

  const { command, args } = parseCommandTemplate(commandTemplate);
  const modelPath = resolveVoiceModelPath();
  const resolvedArgs = args.map((arg) =>
    arg
      .replaceAll("{audio}", audioPath)
      .replaceAll("{output}", outputPath)
      .replaceAll("{model}", modelPath),
  );
  logVoice("transcribe.exec.start", {
    command,
    resolvedArgs,
    modelPath,
    audioBytes: audioBuffer.length,
    audioPath,
    outputPath,
  });

  try {
    const { stdout, stderr } = await execFileAsync(command, resolvedArgs, {
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    logVoice("transcribe.exec.done", {
      stdoutChars: stdout.length,
      stderrChars: stderr.length,
      stderrPreview: stderr.slice(0, 500),
    });
    if (fs.existsSync(outputPath)) {
      const transcript = fs.readFileSync(outputPath, "utf-8").trim();
      logVoice("transcribe.output.direct", {
        transcriptChars: transcript.length,
      });
      return transcript;
    }
    if (fs.existsSync(`${outputPath}.txt`)) {
      const transcript = fs.readFileSync(`${outputPath}.txt`, "utf-8").trim();
      logVoice("transcribe.output.txt", {
        transcriptChars: transcript.length,
      });
      return transcript;
    }
    const transcript = stdout.trim();
    logVoice("transcribe.output.stdout", {
      transcriptChars: transcript.length,
    });
    return transcript;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "unknown transcription error";
    logVoice("transcribe.exec.error", { message });
    throw error;
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
    logVoice("transcribe.cleanup", { tempDirRemoved: tempDir });
  }
}

export function createApp(options: CreateAppOptions = {}): CreateAppResult {
  const port = options.port ?? ROUGHDRAFT_DEFAULT_PORT;
  const homeDir = options.homeDir ?? os.homedir();
  const serverRoot = path.resolve(options.serverRoot ?? defaultServerRoot);
  const staticDirPath = options.staticDirPath ?? staticDir;
  const fetchImpl = options.fetchImpl ?? fetch;
  const remoteDocumentToken =
    typeof options.remoteDocumentToken === "string" &&
    options.remoteDocumentToken.length > 0
      ? options.remoteDocumentToken
      : null;
  const app = express();
  const openRequestClients = new Set<OpenRequestClient>();
  const reviewEvents = new ReviewEventQueue();
  const remoteSessions = new Map<string, RemoteSession>();
  const voiceSessions = new Map<string, VoiceTranscriptionSession>();

  function isAuthorizedRemoteDocumentRequest(req: Request): boolean {
    if (!remoteDocumentToken) return true;

    const header =
      typeof req.headers.authorization === "string"
        ? req.headers.authorization
        : "";
    if (header.startsWith("Bearer ")) {
      const supplied = header.slice("Bearer ".length).trim();
      if (supplied === remoteDocumentToken) return true;
    }

    const acceptsQueryToken =
      req.method === "GET" &&
      req.path.startsWith("/api/remote-document/") &&
      req.path.endsWith("/events");
    const queryToken =
      acceptsQueryToken && typeof req.query.token === "string"
        ? req.query.token
        : "";
    return queryToken === remoteDocumentToken;
  }

  function rejectUnauthorizedRemoteDocumentRequest(res: Response): void {
    res.status(401).json({
      error:
        "Remote document endpoints require a valid token. Set ROUGHDRAFT_TOKEN on the client; browser event streams may include ?token=... in the URL.",
    });
  }

  const remoteSessionSweeper = setInterval(() => {
    const now = Date.now();
    for (const [id, session] of remoteSessions) {
      if (
        session.disconnectedAt !== null &&
        now - session.disconnectedAt > REMOTE_SESSION_TTL_MS
      ) {
        remoteSessions.delete(id);
      }
    }
  }, REMOTE_SESSION_SWEEP_INTERVAL_MS);
  remoteSessionSweeper.unref?.();

  app.use(express.json({ limit: "50mb" }));

  function requestedProjectPath(req: Request): string | null {
    const queryPath =
      typeof req.query.projectPath === "string"
        ? req.query.projectPath.trim()
        : "";
    const bodyPath =
      typeof req.body?.projectPath === "string"
        ? req.body.projectPath.trim()
        : "";
    const nextPath = queryPath || bodyPath;
    return nextPath.length > 0 ? nextPath : null;
  }

  function projectDirFromRequest(
    req: Request,
    res: Response,
    options?: { mustExist?: boolean },
  ): string | null {
    const nextProjectPath = requestedProjectPath(req);
    if (!nextProjectPath) {
      res.status(400).json({ error: "projectPath is required" });
      return null;
    }

    const resolvedProjectDir = path.resolve(nextProjectPath);
    const mustExist = options?.mustExist ?? true;

    if (mustExist && !isExistingDirectory(resolvedProjectDir)) {
      res.status(404).json({ error: "Project directory not found" });
      return null;
    }

    return resolvedProjectDir;
  }

  function markdownPathFromRequest(
    req: Request,
    res: Response,
  ): { relativePath: string; absolutePath: string; projectDir: string } | null {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return null;

    const relativePath =
      typeof req.query.path === "string"
        ? req.query.path
        : typeof req.body?.path === "string"
          ? req.body.path
          : "";
    const absolutePath = ensureProjectPath(projectDir, relativePath);

    if (!absolutePath?.toLowerCase().endsWith(".md")) {
      res.status(404).json({ error: "Markdown file not found" });
      return null;
    }

    if (!fs.existsSync(absolutePath)) {
      res.status(404).json({ error: "Markdown file not found" });
      return null;
    }

    return { relativePath, absolutePath, projectDir };
  }

  // --- API routes ---

  app.get("/api/pages", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const ids = listMdFiles(projectDir);
    const pages = ids.map((id) => {
      const content = fs.readFileSync(
        path.join(projectDir, `${id}.md`),
        "utf-8",
      );
      return { id, title: titleFromContent(content, id), content };
    });
    res.json(pages);
  });

  app.get("/api/pages/:id", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const id = req.params.id;
    const filePath = pageFilePathFromId(projectDir, id);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    res.json({ id, title: titleFromContent(content, id), content });
  });

  app.get("/api/markdown-file", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const relativePath =
      typeof req.query.path === "string" ? req.query.path : "";
    const absolutePath = ensureProjectPath(projectDir, relativePath);

    if (!absolutePath?.toLowerCase().endsWith(".md")) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    if (!fs.existsSync(absolutePath)) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    res.json(markdownPageFromFile(relativePath, absolutePath));
  });

  app.get("/api/markdown-file/events", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const relativePath =
      typeof req.query.path === "string" ? req.query.path : "";
    const absolutePath = ensureProjectPath(projectDir, relativePath);

    if (!absolutePath?.toLowerCase().endsWith(".md")) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    if (!fs.existsSync(absolutePath)) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write("retry: 1000\n\n");

    const sendChange = (stats: fs.Stats) => {
      const exists = stats.nlink > 0;
      res.write(
        `event: change\ndata: ${JSON.stringify({
          path: relativePath,
          exists,
          version: exists ? fileVersionFromFile(absolutePath) : null,
        })}\n\n`,
      );
    };

    const listener = (current: fs.Stats, previous: fs.Stats) => {
      if (
        current.mtimeMs === previous.mtimeMs &&
        current.size === previous.size &&
        current.nlink === previous.nlink
      ) {
        return;
      }

      sendChange(current);
    };

    fs.watchFile(absolutePath, { interval: 500 }, listener);

    req.on("close", () => {
      fs.unwatchFile(absolutePath, listener);
    });
  });

  app.get("/api/review-index", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    const markdown = fs.readFileSync(target.absolutePath, "utf-8");
    res.json({
      documentPath: target.absolutePath,
      projectPath: target.projectDir,
      relativePath: target.relativePath,
      fileVersion: fileVersionFromFile(target.absolutePath),
      ...extractRoughdraftReviewIndex(markdown),
    });
  });

  app.post("/api/review-events", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    const markdown = fs.readFileSync(target.absolutePath, "utf-8");
    const index = extractRoughdraftReviewIndex(markdown);
    const result = reviewEvents.emit({
      documentPath: target.absolutePath,
      projectPath: target.projectDir,
      relativePath: target.relativePath,
      version: fileVersionFromFile(target.absolutePath),
      summary: index.summary,
    });

    res.status(201).json(result);
  });

  app.post("/api/review-events/watch", async (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    const fromNow = req.body?.fromNow !== false;
    const timeoutSeconds =
      typeof req.body?.timeoutSeconds === "number"
        ? req.body.timeoutSeconds
        : undefined;
    const batchWindowSeconds =
      typeof req.body?.batchWindowSeconds === "number"
        ? req.body.batchWindowSeconds
        : 0.25;
    const afterSequence =
      typeof req.body?.afterSequence === "number" ? req.body.afterSequence : 0;

    const result = await reviewEvents.wait({
      documentPath: target.absolutePath,
      afterSequence: fromNow ? reviewEvents.latestSequence() : afterSequence,
      timeoutMs:
        timeoutSeconds !== undefined ? timeoutSeconds * 1000 : undefined,
      batchWindowMs: batchWindowSeconds * 1000,
    });

    res.json(result);
  });

  app.get("/api/review-events/status", (req, res) => {
    const target = markdownPathFromRequest(req, res);
    if (!target) return;

    const watcherCount = reviewEvents.waiterCountForDocument(
      target.absolutePath,
    );
    res.json({
      documentPath: target.absolutePath,
      projectPath: target.projectDir,
      relativePath: target.relativePath,
      watching: watcherCount > 0,
      watcherCount,
    });
  });

  app.post("/api/voice/session/start", (_req, res) => {
    const id = crypto.randomUUID();
    voiceSessions.set(id, {
      id,
      chunks: [],
      mimeType: "audio/webm",
      createdAt: Date.now(),
    });
    logVoice("session.start", { sessionId: id });
    res.status(201).json({ sessionId: id });
  });

  app.post("/api/voice/session/chunk", (req, res) => {
    const sessionId =
      typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    const audioBase64 =
      typeof req.body?.audioBase64 === "string" ? req.body.audioBase64 : "";
    const mimeType =
      typeof req.body?.mimeType === "string" ? req.body.mimeType : "audio/webm";

    const session = voiceSessions.get(sessionId);
    if (!session) {
      logVoice("session.chunk.missing", { sessionId });
      res.status(404).json({ error: "voice session not found" });
      return;
    }

    if (!audioBase64) {
      logVoice("session.chunk.empty", { sessionId });
      res.status(400).json({ error: "audioBase64 is required" });
      return;
    }

    session.mimeType = mimeType;
    const chunk = Buffer.from(audioBase64, "base64");
    session.chunks.push(chunk);
    logVoice("session.chunk", {
      sessionId,
      mimeType,
      chunkBytes: chunk.length,
      totalChunks: session.chunks.length,
    });
    res.json({ ok: true });
  });

  app.post("/api/voice/session/stop", async (req, res) => {
    const sessionId =
      typeof req.body?.sessionId === "string" ? req.body.sessionId : "";
    const session = voiceSessions.get(sessionId);
    if (!session) {
      logVoice("session.stop.missing", { sessionId });
      res.status(404).json({ error: "voice session not found" });
      return;
    }

    voiceSessions.delete(sessionId);
    const buffer = Buffer.concat(session.chunks);
    logVoice("session.stop", {
      sessionId,
      chunks: session.chunks.length,
      totalBytes: buffer.length,
      mimeType: session.mimeType,
      ageMs: Date.now() - session.createdAt,
    });
    if (buffer.length === 0) {
      logVoice("session.stop.empty_audio", { sessionId });
      res.json({ transcript: "" });
      return;
    }

    try {
      const transcript = await transcribeLocalAudioFromBuffer(buffer);
      logVoice("session.stop.transcript", {
        sessionId,
        transcriptChars: transcript.length,
        transcriptPreview: transcript.slice(0, 200),
      });
      res.json({ transcript });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "voice transcription failed";
      logVoice("session.stop.error", {
        sessionId,
        message,
      });
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/voice/process", async (req, res) => {
    logVoice("process.request.received", {
      method: req.method,
      hasBody: Boolean(req.body),
      queryPath:
        typeof req.query.path === "string" ? req.query.path : undefined,
      bodyPath: typeof req.body?.path === "string" ? req.body.path : undefined,
      bodyProjectPath:
        typeof req.body?.projectPath === "string"
          ? req.body.projectPath
          : undefined,
    });
    const target = markdownPathFromRequest(req, res);
    if (!target) {
      logVoice("process.request.rejected.invalid_target", {
        reason: "markdownPathFromRequest returned null",
      });
      return;
    }
    logVoice("process.request.target", {
      relativePath: target.relativePath,
      projectDir: target.projectDir,
      absolutePath: target.absolutePath,
    });

    const payload = req.body as VoiceProcessPayload;
    const utterance =
      typeof payload.utterance === "string" ? payload.utterance.trim() : "";
    const selection = payload.selection;
    const selectedText =
      typeof selection?.selectedText === "string"
        ? selection.selectedText.trim()
        : "";

    if (!utterance) {
      logVoice("process.request.rejected.empty_utterance", {
        utteranceType: typeof payload.utterance,
      });
      res.status(400).json({ error: "utterance is required" });
      return;
    }

    if (!selectedText) {
      logVoice("process.request.rejected.empty_selection", {
        selectionType: typeof selection,
        selectedTextType: typeof selection?.selectedText,
      });
      res.status(400).json({ error: "selection.selectedText is required" });
      return;
    }

    logVoice("process.request.validated", {
      utteranceChars: utterance.length,
      utterancePreview: utterance.slice(0, 200),
      selectionChars: selectedText.length,
      selectionPreview: selectedText.slice(0, 200),
      selectionFrom:
        typeof selection?.from === "number" ? selection.from : undefined,
      selectionTo: typeof selection?.to === "number" ? selection.to : undefined,
    });

    try {
      const startedAt = Date.now();
      const action = await inferVoiceActionWithOpenRouter(
        utterance,
        selectedText,
        fetchImpl,
      );
      logVoice("process.response.success", {
        durationMs: Date.now() - startedAt,
        action: action.action,
        confidence: action.confidence,
        uncertain: action.uncertain === true,
        contentChars: action.content.length,
        contentPreview: action.content.slice(0, 200),
        replacementChars: action.replacementText?.length ?? 0,
        replacementPreview: action.replacementText?.slice(0, 200),
      });
      res.json(action);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "voice processing failed";
      logVoice("process.response.error", {
        message,
      });
      res.status(500).json({ error: message });
    }
  });

  app.put("/api/pages/:id", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const id = req.params.id;
    const filePath = pageFilePathFromId(projectDir, id);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    const { content } = req.body as { content: string };
    fs.writeFileSync(filePath, content);
    res.json({ id, title: titleFromContent(content, id), content });
  });

  app.put("/api/markdown-file", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const relativePath =
      typeof req.query.path === "string" ? req.query.path : "";
    const absolutePath = ensureProjectPath(projectDir, relativePath);

    if (!absolutePath?.toLowerCase().endsWith(".md")) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    if (!fs.existsSync(absolutePath)) {
      res.status(404).json({ error: "Markdown file not found" });
      return;
    }

    const { content, expectedVersion } = req.body as {
      content: string;
      expectedVersion?: string;
    };
    const currentVersion = fileVersionFromFile(absolutePath);

    if (expectedVersion && expectedVersion !== currentVersion) {
      res.status(409).json({
        error: "Markdown file changed on disk",
        current: markdownPageFromFile(relativePath, absolutePath),
      });
      return;
    }

    fs.writeFileSync(absolutePath, content);
    res.json(markdownPageFromFile(relativePath, absolutePath));
  });

  app.post("/api/pages", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const { title, content: bodyContent } = req.body as {
      title?: string;
      content?: string;
    };
    const id = nextUntitledId(projectDir);
    const content = bodyContent || `# ${title || "Untitled"}\n`;
    const filePath = path.join(projectDir, `${id}.md`);
    fs.writeFileSync(filePath, content);

    res.status(201).json(markdownPageFromFile(`${id}.md`, filePath));
  });

  app.delete("/api/pages/:id", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const id = req.params.id;
    const filePath = pageFilePathFromId(projectDir, id);
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ error: "Page not found" });
      return;
    }
    fs.unlinkSync(filePath);

    res.json({ ok: true });
  });

  app.get("/api/status", (_req, res) => {
    res.json({
      backend: "local-files",
      pid: process.pid,
      port,
      projectDir: options.projectDir
        ? path.resolve(options.projectDir)
        : undefined,
      serverRoot,
      stateless: true,
      capabilities: {
        projectPathRequired: true,
        fileSystemBrowsing: true,
        remoteDocuments: true,
        remoteDocumentTokenRequired: remoteDocumentToken !== null,
      },
    });
  });

  app.get("/api/open-requests", (req, res) => {
    const requestedPath =
      typeof req.query.path === "string" && req.query.path.trim().length > 0
        ? req.query.path.trim()
        : null;
    const client: OpenRequestClient = {
      id: nextOpenRequestClientId,
      path: requestedPath,
      response: res,
    };
    nextOpenRequestClientId += 1;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();
    res.write(
      `event: connected\ndata: ${JSON.stringify({ id: client.id })}\n\n`,
    );

    openRequestClients.add(client);
    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, 15_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      openRequestClients.delete(client);
    });
  });

  app.post("/api/open-request", (req, res) => {
    const payload = req.body as OpenRequestPayload;
    const targetPath =
      typeof payload.path === "string" && payload.path.trim().length > 0
        ? payload.path.trim()
        : null;
    const targetUrl =
      typeof payload.url === "string" && payload.url.trim().length > 0
        ? payload.url.trim()
        : null;

    if (!targetPath || !targetUrl) {
      res.status(400).json({ error: "path and url are required" });
      return;
    }

    const matchingClient = Array.from(openRequestClients)
      .reverse()
      .find((client) => client.path === targetPath);

    if (!matchingClient) {
      res.json({ delivered: false });
      return;
    }

    matchingClient.response.write(
      `event: open-request\ndata: ${JSON.stringify({
        path: targetPath,
        url: targetUrl,
      })}\n\n`,
    );
    res.json({ delivered: true });
  });

  app.post("/api/remote-document", (req, res) => {
    if (!isAuthorizedRemoteDocumentRequest(req)) {
      rejectUnauthorizedRemoteDocumentRequest(res);
      return;
    }
    const payload = req.body as RemoteDocumentRegisterPayload;
    const sessionId =
      typeof payload.sessionId === "string" &&
      payload.sessionId.trim().length > 0
        ? payload.sessionId.trim()
        : null;
    const originPath =
      typeof payload.originPath === "string" &&
      payload.originPath.trim().length > 0
        ? payload.originPath.trim()
        : null;
    const content =
      typeof payload.content === "string" ? payload.content : null;

    if (!sessionId || !originPath || content === null) {
      res
        .status(400)
        .json({ error: "sessionId, originPath, and content are required" });
      return;
    }

    if (remoteSessions.has(sessionId)) {
      res.status(409).json({ error: "session already exists" });
      return;
    }

    const session: RemoteSession = {
      id: sessionId,
      originPath,
      content,
      version: remoteSessionVersion(content),
      saveClient: null,
      viewers: new Set<Response>(),
      disconnectedAt: null,
    };
    remoteSessions.set(sessionId, session);

    const host = req.get("host");
    const viewerUrl =
      host !== undefined
        ? `${req.protocol}://${host}/?session=${encodeURIComponent(sessionId)}`
        : null;

    res.status(201).json({
      id: session.id,
      version: session.version,
      viewerUrl,
    });
  });

  app.get("/api/remote-document/:id", (req, res) => {
    if (!isAuthorizedRemoteDocumentRequest(req)) {
      rejectUnauthorizedRemoteDocumentRequest(res);
      return;
    }
    const session = remoteSessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Remote document session not found" });
      return;
    }
    res.json(remoteSessionView(session));
  });

  app.put("/api/remote-document/:id", (req, res) => {
    if (!isAuthorizedRemoteDocumentRequest(req)) {
      rejectUnauthorizedRemoteDocumentRequest(res);
      return;
    }
    const session = remoteSessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Remote document session not found" });
      return;
    }

    const payload = req.body as RemoteDocumentSavePayload;
    const content =
      typeof payload.content === "string" ? payload.content : null;

    if (content === null) {
      res.status(400).json({ error: "content is required" });
      return;
    }

    if (
      typeof payload.expectedVersion === "string" &&
      payload.expectedVersion !== session.version
    ) {
      res.status(409).json({
        error: "Remote document changed",
        current: remoteSessionView(session),
      });
      return;
    }

    session.content = content;
    session.version = remoteSessionVersion(content);

    let deliveredToClient = true;
    if (session.saveClient) {
      try {
        writeRemoteSessionEvent(session.saveClient, "save", {
          content: session.content,
          version: session.version,
        });
      } catch {
        deliveredToClient = false;
        session.saveClient = null;
        session.disconnectedAt = Date.now();
      }
    } else {
      deliveredToClient = false;
    }

    if (!deliveredToClient) {
      res.status(503).json({
        error: "No active CLI session; save not delivered to disk.",
        version: session.version,
      });
      return;
    }

    res.json({ id: session.id, version: session.version });
  });

  app.get("/api/remote-document/:id/events", (req, res) => {
    if (!isAuthorizedRemoteDocumentRequest(req)) {
      rejectUnauthorizedRemoteDocumentRequest(res);
      return;
    }
    const session = remoteSessions.get(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Remote document session not found" });
      return;
    }

    const role = req.query.role === "viewer" ? "viewer" : "cli";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders?.();

    if (role === "cli") {
      if (session.saveClient) {
        session.saveClient.end();
      }

      session.saveClient = res;
      session.disconnectedAt = null;

      writeRemoteSessionEvent(res, "connected", {
        id: session.id,
        role,
        version: session.version,
      });
      for (const viewer of session.viewers) {
        writeRemoteSessionEvent(viewer, "connected", {
          id: session.id,
          role: "viewer",
          version: session.version,
        });
      }
    } else {
      session.viewers.add(res);
      writeRemoteSessionEvent(
        res,
        session.saveClient ? "connected" : "disconnected",
        {
          id: session.id,
          role,
          version: session.version,
        },
      );
    }

    const keepAlive = setInterval(() => {
      res.write(": keep-alive\n\n");
    }, REMOTE_SESSION_KEEPALIVE_MS);

    req.on("close", () => {
      clearInterval(keepAlive);
      if (role === "cli" && session.saveClient === res) {
        session.saveClient = null;
        session.disconnectedAt = Date.now();
        for (const viewer of session.viewers) {
          writeRemoteSessionEvent(viewer, "disconnected", {
            id: session.id,
            role: "viewer",
            version: session.version,
          });
        }
      } else if (role === "viewer") {
        session.viewers.delete(res);
      }
    });
  });

  app.get("/api/update-status", async (_req, res) => {
    const updateStatus = await resolveUpdateStatus({
      fetchImpl,
      packageJsonPath: options.packageJsonPath,
      packageName: options.packageName,
    });
    res.json(updateStatus);
  });

  app.get("/api/directories", (req, res) => {
    const requestedPath =
      typeof req.query.path === "string" && req.query.path.trim().length > 0
        ? path.resolve(req.query.path)
        : homeDir;

    if (!isExistingDirectory(requestedPath)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    res.json(listDirectories(requestedPath));
  });

  app.get("/api/fs/list", (req, res) => {
    const requestedPath =
      typeof req.query.path === "string" && req.query.path.trim().length > 0
        ? path.resolve(req.query.path)
        : homeDir;

    if (!fs.existsSync(requestedPath)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    if (!isExistingDirectory(requestedPath)) {
      res.status(400).json({ error: "Path is not a directory" });
      return;
    }

    try {
      res.json(listFileSystem(requestedPath, homeDir));
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Failed to read directory listing";
      res.status(500).json({ error: message });
    }
  });

  app.get("/api/file-tree", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    res.json(listProjectTree(projectDir));
  });

  app.post("/api/project/open", (req, res) => {
    const requestedPath =
      typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!requestedPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const absolutePath = path.resolve(requestedPath);
    if (!isExistingDirectory(absolutePath)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    res.json({
      backend: "local-files",
      projectDir: absolutePath,
      port,
    });
  });

  app.post("/api/project/create", (req, res) => {
    const requestedPath =
      typeof req.body?.path === "string" ? req.body.path.trim() : "";
    if (!requestedPath) {
      res.status(400).json({ error: "path is required" });
      return;
    }

    const absolutePath = path.resolve(requestedPath);
    ensureDirectoryExists(absolutePath);

    res.status(201).json({
      backend: "local-files",
      projectDir: absolutePath,
      port,
    });
  });

  app.get("/api/files", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const relativePath =
      typeof req.query.path === "string" ? req.query.path : "";
    const absolutePath = ensureProjectPath(projectDir, relativePath);

    if (!absolutePath || !fs.existsSync(absolutePath)) {
      res.status(404).json({ error: "File not found" });
      return;
    }

    res.sendFile(absolutePath);
  });

  app.post("/api/assets", (req, res) => {
    const projectDir = projectDirFromRequest(req, res);
    if (!projectDir) return;

    const payload = req.body as AssetPayload;
    if (!payload.filename || !payload.dataBase64) {
      res.status(400).json({ error: "filename and dataBase64 are required" });
      return;
    }

    const relativePath = nextAssetPath(projectDir, payload.filename);
    const absolutePath = ensureProjectPath(projectDir, relativePath);
    if (!absolutePath) {
      res.status(400).json({ error: "Invalid asset path" });
      return;
    }

    const buffer = Buffer.from(payload.dataBase64, "base64");
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, buffer);

    res.status(201).json({
      markdownPath: `./${relativePath}`,
      previewUrl: `/api/files?projectPath=${encodeURIComponent(projectDir)}&path=${encodeURIComponent(relativePath)}`,
      mimeType: payload.mimeType || "application/octet-stream",
    });
  });

  // --- Static files & SPA fallback ---

  app.use(express.static(staticDirPath));

  app.get("/{*splat}", (_req, res) => {
    res.sendFile(path.join(staticDirPath, "index.html"));
  });

  return { app, port };
}

export const ROUGHDRAFT_TOKEN_ENV = "ROUGHDRAFT_TOKEN";

export async function createServer(
  port = ROUGHDRAFT_DEFAULT_PORT,
  projectDir?: string,
): Promise<void> {
  const bindHosts = resolveBindHosts();
  const remoteDocumentToken = process.env[ROUGHDRAFT_TOKEN_ENV] ?? "";

  if (hasNonLoopbackHost(bindHosts) && remoteDocumentToken.length === 0) {
    throw new Error(
      [
        `Roughdraft refuses to bind ${bindHosts.join(", ")} without a token.`,
        "Non-loopback bindings expose the remote-document endpoints, which can",
        "rewrite files on every connected CLI machine. Set ROUGHDRAFT_TOKEN to",
        "a strong secret and pass the same value to your CLI before retrying,",
        "or remove ROUGHDRAFT_BIND_HOST to keep loopback-only.",
      ].join(" "),
    );
  }

  const { app } = createApp({
    port,
    projectDir,
    remoteDocumentToken:
      remoteDocumentToken.length > 0 ? remoteDocumentToken : undefined,
  });
  const startupKeySummary = summarizeApiKey(
    process.env[ROUGHDRAFT_OPENROUTER_API_KEY_ENV],
  );
  logVoice("server.env.voice", {
    cwd: process.cwd(),
    envModelRaw: process.env[ROUGHDRAFT_LLM_MODEL_ENV] ?? null,
    envModelEffective:
      process.env[ROUGHDRAFT_LLM_MODEL_ENV]?.trim() || DEFAULT_VOICE_MODEL,
    envApiKeyPresent: startupKeySummary.present,
    envApiKeyPrefix: startupKeySummary.prefix,
    envApiKeyLength: startupKeySummary.length,
    envVoiceModelDir: process.env[ROUGHDRAFT_VOICE_MODEL_DIR_ENV] ?? null,
    envVoiceTranscribeCommand:
      process.env[ROUGHDRAFT_VOICE_TRANSCRIBE_COMMAND_ENV] ?? null,
  });
  const listeningHosts: string[] = [];

  await Promise.all(
    bindHosts.map(
      (host) =>
        new Promise<void>((resolve, reject) => {
          const server = createHttpServer(app);

          server.once("error", (error: NodeJS.ErrnoException) => {
            if (
              error.code === "EAFNOSUPPORT" ||
              error.code === "EADDRNOTAVAIL"
            ) {
              resolve();
              return;
            }

            reject(error);
          });

          server.listen(port, host, () => {
            listeningHosts.push(host);
            resolve();
          });
        }),
    ),
  );

  if (listeningHosts.length === 0) {
    throw new Error(
      `Roughdraft could not bind to any host (tried: ${bindHosts.join(", ")}).`,
    );
  }

  console.log(
    `\n  Roughdraft running at http://${ROUGHDRAFT_PUBLIC_HOST}:${port}`,
  );
  console.log("  No active project is stored on the server.\n");
}
