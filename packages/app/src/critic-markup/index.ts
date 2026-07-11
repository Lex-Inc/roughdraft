import { generateHTML, generateJSON, type JSONContent } from "@tiptap/core";
import {
  Marked,
  type RendererThis,
  type Token,
  type TokenizerAndRendererExtension,
  type TokenizerThis,
  type Tokens,
} from "marked";
import type TurndownService from "turndown";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  createEditorExtensions,
  type CriticChangeAttrs,
  type CriticChangeKind,
} from "../editor-extensions";
import {
  createMarkedRenderer,
  createTurndownService,
  normalizeBlockSpacing,
  appendYamlEndmatter,
  prependYamlFrontmatter,
  protectRichTextRoundTripMarkdown,
  splitYamlDocumentMetadata,
  type MarkdownOptions,
} from "../markdown";

export interface CriticComment {
  id: string;
  content: string;
  createdAt: string;
  authorType?: "user" | "ai";
  authorId?: string | null;
  parentCommentId?: string | null;
  scope?: "document";
}

export interface CriticCommentThread {
  comment: CriticComment;
  replies: CriticCommentThread[];
}

export type { CriticChangeAttrs, CriticChangeKind };

interface CriticCommentToken {
  type: "criticCommentAnchor";
  raw: string;
  commentIds: string[];
  tokens: Token[];
}

interface CriticStandaloneCommentToken {
  type: "criticStandaloneComment";
  raw: string;
  commentIds: string[];
}

interface CriticChangeToken {
  type: "criticChange";
  raw: string;
  change: CriticChangeAttrs;
  commentIds: string[];
  tokens?: Token[];
  oldTokens?: Token[];
  newTokens?: Token[];
}

const extensions = createEditorExtensions("");
const criticCommentAnchorPattern = /^\{==([\s\S]+?)==\}/;
const criticCommentBlockPattern =
  /^\{>>([\s\S]*?)<<\}(?:(\{@([\s\S]+?)@\})|(\{(?:\s*[A-Za-z][A-Za-z0-9_-]*="(?:\\[\s\S]|[^"\\])*")+\s*\})|(\{#[A-Za-z][A-Za-z0-9_-]*\}))?/;
const criticAdditionPattern = /^\{\+\+([\s\S]+?)\+\+\}/;
const criticDeletionPattern = /^\{--([\s\S]+?)--\}/;
const criticSubstitutionPattern = /^\{~~([\s\S]+?)~>([\s\S]+?)~~\}/;
const attributeMetadataBlockPattern =
  /^\{(?:\s*[A-Za-z][A-Za-z0-9_-]*="(?:\\[\s\S]|[^"\\])*")+\s*\}/;
const metadataAttributePattern =
  /([A-Za-z][A-Za-z0-9_-]*)="((?:\\[\s\S]|[^"\\])*)"/g;
const metadataReferencePattern = /^\{#([A-Za-z][A-Za-z0-9_-]*)\}$/;
const multilineCommentBodyPattern = /\r?\n[ \t]*\r?\n/;
const unanchoredCommentSentinel = "\u2060";

interface ParsedEndmatter {
  comments: Map<string, Record<string, unknown>>;
  suggestions: Map<string, Record<string, unknown>>;
  data: Record<string, unknown> | null;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseLegacyMetadata(
  metadataText?: string,
): Partial<Omit<CriticComment, "content">> {
  const fields = new Map<string, string>();

  for (const part of metadataText?.split(";") ?? []) {
    const [rawKey, ...valueParts] = part.split(":");
    const key = rawKey?.trim();
    const value = valueParts.join(":").trim();

    if (!key || !value) continue;
    fields.set(key, value);
  }

  const author = fields.get("by") ?? "user";

  return {
    id: fields.get("id"),
    createdAt: fields.get("at") ?? new Date().toISOString(),
    authorType: author.toUpperCase() === "AI" ? "ai" : "user",
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId: fields.get("re") ?? null,
  };
}

function unescapeMetadataAttributeValue(value: string): string {
  return value.replaceAll(/\\([\s\S])/g, "$1");
}

function escapeMetadataAttributeValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

function parseMetadataAttributeFields(
  metadataText?: string,
): Map<string, string> {
  const fields = new Map<string, string>();

  if (!metadataText?.startsWith("{") || !metadataText.endsWith("}")) {
    return fields;
  }

  const content = metadataText.slice(1, -1);

  for (const match of content.matchAll(metadataAttributePattern)) {
    fields.set(match[1], unescapeMetadataAttributeValue(match[2]));
  }

  return fields;
}

function parseAttributeMetadata(
  metadataText?: string,
): Partial<Omit<CriticComment, "content">> {
  const fields = parseMetadataAttributeFields(metadataText);

  const author = fields.get("by") ?? "user";

  return {
    id: fields.get("id"),
    createdAt: fields.get("at") ?? new Date().toISOString(),
    authorType: author.toUpperCase() === "AI" ? "ai" : "user",
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId: fields.get("re") ?? null,
  };
}

function commentPartialFromEndmatterEntry(
  id: string,
  entry?: Record<string, unknown>,
  options?: { includeParent?: boolean },
): Partial<Omit<CriticComment, "content">> {
  const author = typeof entry?.by === "string" ? entry.by : "user";
  const includeParent = options?.includeParent ?? true;

  return {
    id,
    createdAt:
      typeof entry?.at === "string" ? entry.at : new Date().toISOString(),
    authorType: author.toUpperCase() === "AI" ? "ai" : "user",
    authorId: author.toUpperCase() === "AI" ? null : author,
    parentCommentId:
      includeParent && typeof entry?.re === "string" ? entry.re : null,
  };
}

function parseMetadata(
  legacyMetadataText?: string,
  attributeMetadataText?: string,
  referenceMetadataText?: string,
  endmatter?: ParsedEndmatter,
  kind: "comment" | "suggestion" = "comment",
): Partial<Omit<CriticComment, "content">> {
  const reference = referenceMetadataText?.match(metadataReferencePattern);
  if (reference) {
    const id = reference[1] ?? "";
    const entry =
      kind === "comment"
        ? endmatter?.comments.get(id)
        : endmatter?.suggestions.get(id);
    return commentPartialFromEndmatterEntry(id, entry, {
      includeParent: false,
    });
  }

  if (attributeMetadataText) {
    return parseAttributeMetadata(attributeMetadataText);
  }

  return parseLegacyMetadata(legacyMetadataText);
}

function commentContentFromMarker(
  commentText: string,
  referenceMetadataText?: string,
  endmatter?: ParsedEndmatter,
): string {
  const reference = referenceMetadataText?.match(metadataReferencePattern);
  if (!reference || commentText.length > 0) return commentText;

  const body = endmatter?.comments.get(reference[1] ?? "")?.body;
  return typeof body === "string" ? body : commentText;
}

function serializeMetadata(comment: CriticComment): string {
  const fields = [
    ["id", comment.id],
    ["by", comment.authorType === "ai" ? "AI" : comment.authorId || "user"],
    ["at", comment.createdAt || new Date().toISOString()],
  ];

  if (comment.parentCommentId) {
    fields.push(["re", comment.parentCommentId]);
  }

  return `{${fields
    .map(([key, value]) => `${key}="${escapeMetadataAttributeValue(value)}"`)
    .join(" ")}}`;
}

function serializeChangeMetadata(change: CriticChangeAttrs): string {
  return serializeMetadata({
    id: change.changeId,
    content: "",
    createdAt: change.createdAt,
    authorType: change.authorType,
    authorId: change.authorId,
  });
}

function parseReviewEndmatter(endmatter?: string | null): ParsedEndmatter {
  if (!endmatter) {
    return { comments: new Map(), suggestions: new Map(), data: null };
  }

  const yamlText = endmatter.replace(/^---[ \t]*(?:\r\n|\n)/, "");
  let parsed: unknown;
  try {
    parsed = parseYaml(yamlText);
  } catch {
    return { comments: new Map(), suggestions: new Map(), data: null };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { comments: new Map(), suggestions: new Map(), data: null };
  }

  const record = parsed as Record<string, unknown>;
  return {
    comments: parseEndmatterMap(record.comments),
    suggestions: parseEndmatterMap(record.suggestions),
    data: record,
  };
}

function parseEndmatterMap(
  value: unknown,
): Map<string, Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return new Map();
  }

  return new Map(
    Object.entries(value as Record<string, unknown>).filter(
      (entry): entry is [string, Record<string, unknown>] =>
        Boolean(entry[1]) &&
        typeof entry[1] === "object" &&
        !Array.isArray(entry[1]),
    ),
  );
}

function addEndmatterFeedback(
  comments: Map<string, CriticComment>,
  endmatter: ParsedEndmatter,
) {
  for (const [id, entry] of endmatter.comments) {
    if (typeof entry.body !== "string") {
      continue;
    }
    if (comments.has(id)) {
      continue;
    }

    comments.set(
      id,
      createCommentWithContext({
        ...commentPartialFromEndmatterEntry(id, entry),
        content: entry.body,
        parentCommentId: typeof entry.re === "string" ? entry.re : null,
        scope: typeof entry.re === "string" ? undefined : "document",
      }),
    );
  }
}

function cloneParsedEndmatter(endmatter: ParsedEndmatter): ParsedEndmatter {
  return {
    comments: new Map(
      [...endmatter.comments].map(([id, entry]) => [id, { ...entry }]),
    ),
    suggestions: new Map(
      [...endmatter.suggestions].map(([id, entry]) => [id, { ...entry }]),
    ),
    data: endmatter.data ? { ...endmatter.data } : null,
  };
}

function parsedEndmatterToYaml(endmatter: ParsedEndmatter): string | null {
  const data: Record<string, unknown> = endmatter.data
    ? { ...endmatter.data }
    : {};

  if (endmatter.comments.size > 0) {
    data.comments = Object.fromEntries(endmatter.comments);
  } else {
    delete data.comments;
  }

  if (endmatter.suggestions.size > 0) {
    data.suggestions = Object.fromEntries(endmatter.suggestions);
  } else {
    delete data.suggestions;
  }

  if (Object.keys(data).length === 0) return null;

  return `---\n${stringifyYaml(data).trimEnd()}\n`;
}

function collectPatternRanges(markdown: string, pattern: RegExp) {
  const ranges: Array<{ start: number; end: number }> = [];

  for (const match of markdown.matchAll(pattern)) {
    if (match.index === undefined) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges;
}

function collectInlineCodeRanges(markdown: string) {
  const ranges: Array<{ start: number; end: number }> = [];

  for (const match of markdown.matchAll(/(`+)([\s\S]*?)\1/g)) {
    if (match.index === undefined) continue;
    ranges.push({ start: match.index, end: match.index + match[0].length });
  }

  return ranges;
}

function collectLiteralMarkdownRanges(markdown: string) {
  return [
    ...collectPatternRanges(
      markdown,
      /^[ \t]*<details\b[\s\S]*?<\/details>[ \t]*(?:\r?\n|$)/gim,
    ),
    ...collectPatternRanges(
      markdown,
      /^[ \t]*<!--[\s\S]*?-->[ \t]*(?:\r?\n|$)/gm,
    ),
    ...collectInlineCodeRanges(markdown),
  ].sort((left, right) => left.start - right.start || left.end - right.end);
}

function findContainingRange(
  ranges: Array<{ start: number; end: number }>,
  offset: number,
) {
  return ranges.find((range) => range.start <= offset && offset < range.end);
}

function normalizeLegacyMultilineComments(
  body: string,
  parsedEndmatter: ParsedEndmatter,
): {
  body: string;
  parsedEndmatter: ParsedEndmatter;
  endmatter: string | null;
} {
  let cursor = 0;
  let normalized = "";
  let nextEndmatter = parsedEndmatter;
  let changed = false;
  const literalRanges = collectLiteralMarkdownRanges(body);

  while (cursor < body.length) {
    const anchorOffset = body.indexOf("{==", cursor);

    if (anchorOffset === -1) {
      normalized += body.slice(cursor);
      break;
    }

    const literalRange = findContainingRange(literalRanges, anchorOffset);
    if (literalRange) {
      normalized += body.slice(cursor, literalRange.end);
      cursor = literalRange.end;
      continue;
    }

    const anchorClose = body.indexOf("==}", anchorOffset + 3);

    if (anchorClose === -1) {
      normalized += body.slice(cursor);
      break;
    }

    normalized += body.slice(cursor, anchorOffset);
    normalized += body.slice(anchorOffset, anchorClose + 3);

    let nextOffset = anchorClose + 3;
    let matchedComment = false;

    while (body.startsWith("{>>", nextOffset)) {
      const commentClose = body.indexOf("<<}", nextOffset + 3);

      if (commentClose === -1) break;

      const metadataMatch = body
        .slice(commentClose + 3)
        .match(attributeMetadataBlockPattern);

      if (!metadataMatch) break;

      matchedComment = true;
      const commentText = body.slice(nextOffset + 3, commentClose);
      const metadataText = metadataMatch[0];
      const metadataEnd = commentClose + 3 + metadataText.length;
      const fields = parseMetadataAttributeFields(metadataText);
      const id = fields.get("id");

      if (!id || !multilineCommentBodyPattern.test(commentText)) {
        normalized += body.slice(nextOffset, metadataEnd);
        nextOffset = metadataEnd;
        continue;
      }

      if (!changed) {
        nextEndmatter = cloneParsedEndmatter(parsedEndmatter);
        changed = true;
      }

      const entry: Record<string, unknown> = {
        ...(nextEndmatter.comments.get(id) ?? {}),
        body: commentText,
        by: fields.get("by") ?? "user",
        at: fields.get("at") ?? new Date().toISOString(),
      };
      const parentId = fields.get("re");

      if (parentId) {
        entry.re = parentId;
      } else {
        delete entry.re;
      }

      nextEndmatter.comments.set(id, entry);
      normalized += `{>><<}{#${id}}`;
      nextOffset = metadataEnd;
    }

    if (!matchedComment) {
      cursor = anchorClose + 3;
      continue;
    }

    cursor = nextOffset;
  }

  if (!changed) {
    return { body, parsedEndmatter, endmatter: null };
  }

  return {
    body: normalized,
    parsedEndmatter: nextEndmatter,
    endmatter: parsedEndmatterToYaml(nextEndmatter),
  };
}

function areEndmatterEntriesEqual(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);

  for (const key of keys) {
    if (left[key] !== right[key]) return false;
  }

  return true;
}

function areEndmatterMapsEqual(
  left: Map<string, Record<string, unknown>>,
  right: Map<string, Record<string, unknown>>,
): boolean {
  if (left.size !== right.size) return false;

  for (const [id, leftEntry] of left) {
    const rightEntry = right.get(id);
    if (!rightEntry || !areEndmatterEntriesEqual(leftEntry, rightEntry)) {
      return false;
    }
  }

  return true;
}

function endmatterEntryForComment(
  comment: CriticComment,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const by = comment.authorType === "ai" ? "AI" : comment.authorId || "user";
  const next: Record<string, unknown> = {
    ...existing,
    by,
    at: comment.createdAt,
  };

  if (comment.scope === "document") {
    next.body = comment.content;
    delete next.re;
  } else if (comment.parentCommentId) {
    next.body = comment.content;
    next.re = comment.parentCommentId;
  } else if (
    typeof existing.body === "string" ||
    multilineCommentBodyPattern.test(comment.content)
  ) {
    next.body = comment.content;
    delete next.re;
  } else {
    delete next.body;
    delete next.re;
  }

  return next;
}

function endmatterEntryForChange(
  change: CriticChangeAttrs,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const by = change.authorType === "ai" ? "AI" : change.authorId || "user";

  return {
    ...existing,
    by,
    at: change.createdAt,
  };
}

function serializeReviewEndmatter(
  existingEndmatter: string | null,
  comments: Map<string, CriticComment>,
  changes: Map<string, CriticChangeAttrs>,
): string | null {
  if (!existingEndmatter) return null;

  const parsed = parseReviewEndmatter(existingEndmatter);
  const commentEntries = new Map<string, Record<string, unknown>>();
  const suggestionEntries = new Map<string, Record<string, unknown>>();

  for (const comment of comments.values()) {
    commentEntries.set(
      comment.id,
      endmatterEntryForComment(comment, parsed.comments.get(comment.id)),
    );
  }

  for (const change of changes.values()) {
    suggestionEntries.set(
      change.changeId,
      endmatterEntryForChange(change, parsed.suggestions.get(change.changeId)),
    );
  }

  if (
    areEndmatterMapsEqual(parsed.comments, commentEntries) &&
    areEndmatterMapsEqual(parsed.suggestions, suggestionEntries)
  ) {
    return existingEndmatter;
  }

  const data: Record<string, unknown> = { ...(parsed.data ?? {}) };
  if (commentEntries.size > 0) {
    data.comments = Object.fromEntries(commentEntries);
  } else {
    delete data.comments;
  }
  if (suggestionEntries.size > 0) {
    data.suggestions = Object.fromEntries(suggestionEntries);
  } else {
    delete data.suggestions;
  }

  if (Object.keys(data).length === 0) return null;

  return `---\n${stringifyYaml(data)}`;
}

export function createNextCommentId(
  existingComments: Iterable<Pick<CriticComment, "id">>,
): string {
  let maxId = 0;

  for (const comment of existingComments) {
    const match = comment.id.match(/^c(\d+)$/);
    if (!match) continue;

    const parsed = Number.parseInt(match[1] || "0", 10);
    if (parsed > maxId) {
      maxId = parsed;
    }
  }

  return `c${maxId + 1}`;
}

export function createNextChangeId(
  existingChanges: Iterable<Pick<CriticChangeAttrs, "changeId">>,
): string {
  let maxId = 0;

  for (const change of existingChanges) {
    const match = change.changeId.match(/^s(\d+)$/);
    if (!match) continue;

    const parsed = Number.parseInt(match[1] || "0", 10);
    if (parsed > maxId) {
      maxId = parsed;
    }
  }

  return `s${maxId + 1}`;
}

function createCommentWithContext(
  partial?: Partial<CriticComment>,
  existingComments: Iterable<Pick<CriticComment, "id">> = [],
): CriticComment {
  const authorType = partial?.authorType ?? "user";

  return {
    id: partial?.id ?? createNextCommentId(existingComments),
    content: partial?.content ?? "",
    createdAt: partial?.createdAt ?? new Date().toISOString(),
    authorType,
    authorId: partial?.authorId ?? (authorType === "ai" ? null : "user"),
    parentCommentId: partial?.parentCommentId ?? null,
    scope: partial?.scope,
  };
}

function createChangeWithContext(
  kind: CriticChangeKind,
  partial?: Partial<CriticChangeAttrs>,
  existingChanges: Iterable<Pick<CriticChangeAttrs, "changeId">> = [],
): CriticChangeAttrs {
  const authorType = partial?.authorType ?? "user";

  return {
    kind,
    changeId: partial?.changeId ?? createNextChangeId(existingChanges),
    createdAt: partial?.createdAt ?? new Date().toISOString(),
    authorType,
    authorId: partial?.authorId ?? (authorType === "ai" ? null : "user"),
  };
}

function parseChangeMetadata(
  metadataText?: string,
  endmatter?: ParsedEndmatter,
): Partial<CriticChangeAttrs> {
  const reference = metadataText?.match(metadataReferencePattern);
  if (reference) {
    const id = reference[1] ?? "";
    const entry = endmatter?.suggestions.get(id);
    const parsed = commentPartialFromEndmatterEntry(id, entry);
    return {
      changeId: parsed.id,
      createdAt: parsed.createdAt,
      authorType: parsed.authorType,
      authorId: parsed.authorId,
    };
  }

  const parsed = parseAttributeMetadata(metadataText);

  return {
    changeId: parsed.id,
    createdAt: parsed.createdAt,
    authorType: parsed.authorType,
    authorId: parsed.authorId,
  };
}

function buildCommentThreadsFromOrderedComments(
  orderedComments: CriticComment[],
): CriticCommentThread[] {
  const validCommentIds = new Set(orderedComments.map((comment) => comment.id));
  const repliesByParentId = new Map<string, CriticComment[]>();
  const rootComments: CriticComment[] = [];

  for (const comment of orderedComments) {
    const parentCommentId = comment.parentCommentId;

    if (
      !parentCommentId ||
      parentCommentId === comment.id ||
      !validCommentIds.has(parentCommentId)
    ) {
      rootComments.push(comment);
      continue;
    }

    const replies = repliesByParentId.get(parentCommentId) ?? [];
    replies.push(comment);
    repliesByParentId.set(parentCommentId, replies);
  }

  const buildNode = (comment: CriticComment): CriticCommentThread => ({
    comment,
    replies: (repliesByParentId.get(comment.id) ?? []).map(buildNode),
  });

  return rootComments.map(buildNode);
}

export function buildCommentThreads(
  comments: Iterable<CriticComment>,
): CriticCommentThread[] {
  return buildCommentThreadsFromOrderedComments([...comments]);
}

export function flattenCommentThreads(
  threads: Iterable<CriticCommentThread>,
): CriticComment[] {
  const orderedComments: CriticComment[] = [];

  const visit = (thread: CriticCommentThread) => {
    orderedComments.push(thread.comment);
    for (const reply of thread.replies) {
      visit(reply);
    }
  };

  for (const thread of threads) {
    visit(thread);
  }

  return orderedComments;
}

function getOrderedAnchorComments(
  commentIds: string[],
  comments: ReadonlyMap<string, CriticComment>,
): CriticComment[] {
  const visibleComments = commentIds
    .map((commentId) => comments.get(commentId))
    .filter((comment): comment is CriticComment => Boolean(comment));

  return flattenCommentThreads(buildCommentThreads(visibleComments));
}

function serializeCommentBlocks(
  commentIds: string[],
  comments: ReadonlyMap<string, CriticComment>,
  useEndmatter = false,
): string {
  const orderedComments = useEndmatter
    ? commentIds
        .map((commentId) => comments.get(commentId))
        .filter(
          (comment): comment is CriticComment =>
            comment !== undefined && !comment.parentCommentId,
        )
    : getOrderedAnchorComments(commentIds, comments);
  let result = "";

  for (const comment of orderedComments) {
    const inlineContent =
      useEndmatter && multilineCommentBodyPattern.test(comment.content)
        ? ""
        : comment.content;
    result += `{>>${inlineContent}<<}${
      useEndmatter ? `{#${comment.id}}` : serializeMetadata(comment)
    }`;
  }

  return result;
}

export function getCommentDescendantIds(
  commentId: string,
  comments: ReadonlyMap<string, CriticComment>,
): string[] {
  const childrenByParentId = new Map<string, string[]>();

  for (const comment of comments.values()) {
    if (!comment.parentCommentId || comment.parentCommentId === comment.id) {
      continue;
    }

    const childIds = childrenByParentId.get(comment.parentCommentId) ?? [];
    childIds.push(comment.id);
    childrenByParentId.set(comment.parentCommentId, childIds);
  }

  const descendantIds: string[] = [];
  const stack = [...(childrenByParentId.get(commentId) ?? [])].reverse();

  while (stack.length > 0) {
    const nextCommentId = stack.pop();
    if (!nextCommentId) continue;

    descendantIds.push(nextCommentId);

    const childIds = childrenByParentId.get(nextCommentId) ?? [];
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      const childId = childIds[index];
      if (childId) {
        stack.push(childId);
      }
    }
  }

  return descendantIds;
}

function tokenizeCriticCommentAnchor(
  lexer: TokenizerThis["lexer"],
  src: string,
  existingComments: Iterable<Pick<CriticComment, "id">>,
  endmatter?: ParsedEndmatter,
):
  | {
      token: CriticCommentToken;
      comments: CriticComment[];
    }
  | undefined {
  const anchorMatch = src.match(criticCommentAnchorPattern);

  if (!anchorMatch) return undefined;

  const [, anchor] = anchorMatch;
  let raw = anchorMatch[0];
  let offset = raw.length;
  const parsedComments: CriticComment[] = [];

  while (offset < src.length) {
    const nextMatch = src.slice(offset).match(criticCommentBlockPattern);
    if (!nextMatch) break;

    const [
      ,
      commentText,
      ,
      legacyMetadataText,
      attributeMetadataText,
      referenceMetadataText,
    ] = nextMatch;
    const comment = createCommentWithContext(
      {
        ...parseMetadata(
          legacyMetadataText,
          attributeMetadataText,
          referenceMetadataText,
          endmatter,
          "comment",
        ),
        content: commentContentFromMarker(
          commentText,
          referenceMetadataText,
          endmatter,
        ),
      },
      [...existingComments, ...parsedComments],
    );
    parsedComments.push(comment);
    raw += nextMatch[0];
    offset += nextMatch[0].length;
  }

  if (parsedComments.length === 0) return undefined;

  return {
    token: {
      type: "criticCommentAnchor",
      raw,
      commentIds: parsedComments.map((comment) => comment.id),
      tokens: lexer.inlineTokens(anchor),
    },
    comments: parsedComments,
  };
}

function getTrailingAttributeMetadata(src: string, offset: number) {
  const reference = src.slice(offset).match(/^\{#[A-Za-z][A-Za-z0-9_-]*\}/);
  if (reference) {
    return {
      metadataText: reference[0],
      raw: reference[0],
    };
  }

  const match = src.slice(offset).match(attributeMetadataBlockPattern);

  if (!match) {
    return {
      metadataText: undefined,
      raw: "",
    };
  }

  return {
    metadataText: match[0],
    raw: match[0],
  };
}

function tokenizeCriticCommentBlocks(
  src: string,
  offset: number,
  existingComments: Iterable<Pick<CriticComment, "id">>,
  endmatter?: ParsedEndmatter,
) {
  let raw = "";
  let nextOffset = offset;
  const parsedComments: CriticComment[] = [];

  while (nextOffset < src.length) {
    const nextMatch = src.slice(nextOffset).match(criticCommentBlockPattern);
    if (!nextMatch) break;

    const [
      ,
      commentText,
      ,
      legacyMetadataText,
      attributeMetadataText,
      referenceMetadataText,
    ] = nextMatch;
    const comment = createCommentWithContext(
      {
        ...parseMetadata(
          legacyMetadataText,
          attributeMetadataText,
          referenceMetadataText,
          endmatter,
          "comment",
        ),
        content: commentContentFromMarker(
          commentText,
          referenceMetadataText,
          endmatter,
        ),
      },
      [...existingComments, ...parsedComments],
    );
    parsedComments.push(comment);
    raw += nextMatch[0];
    nextOffset += nextMatch[0].length;
  }

  return {
    raw,
    comments: parsedComments,
  };
}

function tokenizeCriticStandaloneComment(
  src: string,
  existingComments: Iterable<Pick<CriticComment, "id">>,
  endmatter?: ParsedEndmatter,
):
  | {
      token: CriticStandaloneCommentToken;
      comments: CriticComment[];
    }
  | undefined {
  const result = tokenizeCriticCommentBlocks(
    src,
    0,
    existingComments,
    endmatter,
  );

  if (result.comments.length === 0) return undefined;

  return {
    token: {
      type: "criticStandaloneComment",
      raw: result.raw,
      commentIds: result.comments.map((comment) => comment.id),
    },
    comments: result.comments,
  };
}

function tokenizeCriticChange(
  lexer: TokenizerThis["lexer"],
  src: string,
  existingChanges: Iterable<Pick<CriticChangeAttrs, "changeId">>,
  existingComments: Iterable<Pick<CriticComment, "id">>,
  endmatter?: ParsedEndmatter,
):
  | {
      token: CriticChangeToken;
      comments: CriticComment[];
    }
  | undefined {
  const additionMatch = src.match(criticAdditionPattern);

  if (additionMatch) {
    const [, text] = additionMatch;
    const metadata = getTrailingAttributeMetadata(src, additionMatch[0].length);
    const trailingComments = tokenizeCriticCommentBlocks(
      src,
      additionMatch[0].length + metadata.raw.length,
      existingComments,
      endmatter,
    );
    const change = createChangeWithContext(
      "addition",
      parseChangeMetadata(metadata.metadataText, endmatter),
      existingChanges,
    );

    return {
      token: {
        type: "criticChange",
        raw: additionMatch[0] + metadata.raw + trailingComments.raw,
        change,
        commentIds: trailingComments.comments.map((comment) => comment.id),
        tokens: lexer.inlineTokens(text),
      },
      comments: trailingComments.comments,
    };
  }

  const deletionMatch = src.match(criticDeletionPattern);

  if (deletionMatch) {
    const [, text] = deletionMatch;
    const metadata = getTrailingAttributeMetadata(src, deletionMatch[0].length);
    const trailingComments = tokenizeCriticCommentBlocks(
      src,
      deletionMatch[0].length + metadata.raw.length,
      existingComments,
      endmatter,
    );
    const change = createChangeWithContext(
      "deletion",
      parseChangeMetadata(metadata.metadataText, endmatter),
      existingChanges,
    );

    return {
      token: {
        type: "criticChange",
        raw: deletionMatch[0] + metadata.raw + trailingComments.raw,
        change,
        commentIds: trailingComments.comments.map((comment) => comment.id),
        tokens: lexer.inlineTokens(text),
      },
      comments: trailingComments.comments,
    };
  }

  const substitutionMatch = src.match(criticSubstitutionPattern);

  if (substitutionMatch) {
    const [, oldText, newText] = substitutionMatch;
    const metadata = getTrailingAttributeMetadata(
      src,
      substitutionMatch[0].length,
    );
    const trailingComments = tokenizeCriticCommentBlocks(
      src,
      substitutionMatch[0].length + metadata.raw.length,
      existingComments,
      endmatter,
    );
    const change = createChangeWithContext(
      "substitution-old",
      parseChangeMetadata(metadata.metadataText, endmatter),
      existingChanges,
    );

    return {
      token: {
        type: "criticChange",
        raw: substitutionMatch[0] + metadata.raw + trailingComments.raw,
        change,
        commentIds: trailingComments.comments.map((comment) => comment.id),
        oldTokens: lexer.inlineTokens(oldText),
        newTokens: lexer.inlineTokens(newText),
      },
      comments: trailingComments.comments,
    };
  }

  return undefined;
}

function renderCriticChangeSpan(
  change: CriticChangeAttrs,
  content: string,
  kind: CriticChangeKind = change.kind,
  commentIds: string[] = [],
) {
  const by = change.authorType === "ai" ? "AI" : change.authorId || "user";
  const changeSpan = `<span data-critic-change-kind="${escapeHtml(kind)}" data-critic-change-id="${escapeHtml(
    change.changeId,
  )}" data-critic-change-by="${escapeHtml(by)}" data-critic-change-at="${escapeHtml(
    change.createdAt,
  )}">${content}</span>`;

  if (commentIds.length === 0) {
    return changeSpan;
  }

  return `<span data-comment-ids="${escapeHtml(
    JSON.stringify(commentIds),
  )}">${changeSpan}</span>`;
}

function renderCriticCodeText(
  text: string,
  comments: Map<string, CriticComment>,
  endmatter?: ParsedEndmatter,
) {
  let result = "";
  let offset = 0;

  while (offset < text.length) {
    const anchorMatch = text.slice(offset).match(criticCommentAnchorPattern);

    if (!anchorMatch || anchorMatch.index !== 0) {
      result += escapeHtml(text[offset] ?? "");
      offset += 1;
      continue;
    }

    const [, anchor] = anchorMatch;
    let nextOffset = offset + anchorMatch[0].length;
    const parsedComments: CriticComment[] = [];

    while (nextOffset < text.length) {
      const commentMatch = text
        .slice(nextOffset)
        .match(criticCommentBlockPattern);
      if (!commentMatch) break;

      const [
        ,
        commentText,
        ,
        legacyMetadataText,
        attributeMetadataText,
        referenceMetadataText,
      ] = commentMatch;
      const comment = createCommentWithContext(
        {
          ...parseMetadata(
            legacyMetadataText,
            attributeMetadataText,
            referenceMetadataText,
            endmatter,
            "comment",
          ),
          content: commentContentFromMarker(
            commentText,
            referenceMetadataText,
            endmatter,
          ),
        },
        [...comments.values(), ...parsedComments],
      );
      parsedComments.push(comment);
      nextOffset += commentMatch[0].length;
    }

    if (parsedComments.length === 0) {
      result += escapeHtml(anchorMatch[0]);
      offset += anchorMatch[0].length;
      continue;
    }

    for (const comment of parsedComments) {
      comments.set(comment.id, comment);
    }

    result += `<span data-comment-ids="${escapeHtml(
      JSON.stringify(parsedComments.map((comment) => comment.id)),
    )}">${escapeHtml(anchor)}</span>`;
    offset = nextOffset;
  }

  return result;
}

function renderCriticCodeBlock(
  token: Tokens.Code,
  comments: Map<string, CriticComment>,
  endmatter?: ParsedEndmatter,
) {
  const language = (token.lang || "").match(/\S+/)?.[0];
  const classAttr = language ? ` class="language-${escapeHtml(language)}"` : "";
  const content = token.escaped
    ? token.text
    : renderCriticCodeText(token.text, comments, endmatter);

  return `<pre><code${classAttr}>${content}</code></pre>\n`;
}

function addCriticCommentRule(
  service: TurndownService,
  comments: Map<string, CriticComment>,
  useEndmatter = false,
) {
  service.addRule("criticComment", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      (node as HTMLElement).hasAttribute("data-comment-ids"),
    replacement(content, node) {
      const commentIdsText = (node as HTMLElement).getAttribute(
        "data-comment-ids",
      );

      if (!commentIdsText) return content;

      let commentIds: string[] = [];

      try {
        commentIds = JSON.parse(commentIdsText) as string[];
      } catch {
        return content;
      }

      const criticChangeElement = (node as HTMLElement).querySelector(
        "span[data-critic-change-kind]",
      );
      if (criticChangeElement instanceof HTMLElement) {
        return serializeCriticChangeElement(
          service,
          criticChangeElement,
          service.turndown(criticChangeElement.innerHTML).trim(),
          comments,
          commentIds,
          useEndmatter,
        );
      }

      const commentBlocks = serializeCommentBlocks(
        commentIds,
        comments,
        useEndmatter,
      );
      if (!commentBlocks) return content;
      if (content === unanchoredCommentSentinel) return commentBlocks;

      return `{==${content}==}${commentBlocks}`;
    },
  });
}

function addCriticCodeBlockRule(service: TurndownService) {
  service.addRule("criticCodeBlock", {
    filter: (node) => {
      if (node.nodeName !== "PRE") return false;
      const codeElement = (node as HTMLElement).firstElementChild;
      return (
        codeElement?.nodeName === "CODE" &&
        Boolean(
          codeElement.querySelector(
            "span[data-comment-ids], span[data-critic-change-kind]",
          ),
        )
      );
    },
    replacement(_content, node) {
      const codeElement = (node as HTMLElement)
        .firstElementChild as HTMLElement | null;

      if (!codeElement) return "";

      const language =
        [...codeElement.classList]
          .find((className) => className.startsWith("language-"))
          ?.slice("language-".length) ?? "";
      const content = service.turndown(codeElement.innerHTML).trimEnd();

      return `\n\n\`\`\`${language}\n${content}\n\`\`\`\n\n`;
    },
  });
}

function getElementChangeAttrs(element: HTMLElement): CriticChangeAttrs | null {
  const kind = element.getAttribute("data-critic-change-kind");
  const changeId = element.getAttribute("data-critic-change-id");
  const createdAt = element.getAttribute("data-critic-change-at");

  if (
    kind !== "addition" &&
    kind !== "deletion" &&
    kind !== "substitution-old" &&
    kind !== "substitution-new"
  ) {
    return null;
  }

  if (!changeId || !createdAt) return null;

  const rawBy = element.getAttribute("data-critic-change-by") || "user";
  const authorType = rawBy.toUpperCase() === "AI" ? "ai" : "user";

  return {
    kind,
    changeId,
    createdAt,
    authorType,
    authorId: authorType === "ai" ? null : rawBy,
  };
}

function isPairedSubstitutionElement(
  element: Element | null,
  kind: CriticChangeKind,
  changeId: string,
) {
  return (
    element instanceof HTMLElement &&
    element.getAttribute("data-critic-change-kind") === kind &&
    element.getAttribute("data-critic-change-id") === changeId
  );
}

function getElementCommentIds(element: HTMLElement): string[] {
  const commentIdsText = element.getAttribute("data-comment-ids");
  if (!commentIdsText) return [];

  try {
    const parsed = JSON.parse(commentIdsText) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}

function getChangeCommentBlocks(
  element: HTMLElement,
  comments: Map<string, CriticComment>,
  extraCommentIds: string[] = [],
  useEndmatter = false,
) {
  return serializeCommentBlocks(
    [...new Set([...getElementCommentIds(element), ...extraCommentIds])],
    comments,
    useEndmatter,
  );
}

function serializeCriticChangeElement(
  service: TurndownService,
  element: HTMLElement,
  content: string,
  comments: Map<string, CriticComment>,
  extraCommentIds: string[] = [],
  useEndmatter = false,
) {
  const change = getElementChangeAttrs(element);

  if (!change) return content;

  const commentBlocks = getChangeCommentBlocks(
    element,
    comments,
    extraCommentIds,
    useEndmatter,
  );
  const metadata = useEndmatter
    ? `{#${change.changeId}}`
    : serializeChangeMetadata(change);

  if (change.kind === "addition") {
    return `{++${content}++}${metadata}${commentBlocks}`;
  }

  if (change.kind === "deletion") {
    return `{--${content}--}${metadata}${commentBlocks}`;
  }

  if (change.kind === "substitution-new") {
    return isPairedSubstitutionElement(
      element.previousElementSibling,
      "substitution-old",
      change.changeId,
    )
      ? ""
      : `{++${content}++}${
          useEndmatter
            ? `{#${change.changeId}}`
            : serializeChangeMetadata({
                ...change,
                kind: "addition",
              })
        }${commentBlocks}`;
  }

  const nextElement = element.nextElementSibling;

  if (
    nextElement instanceof HTMLElement &&
    isPairedSubstitutionElement(
      nextElement,
      "substitution-new",
      change.changeId,
    )
  ) {
    const replacement = service.turndown(nextElement.innerHTML).trim();
    return `{~~${content}~>${replacement}~~}${metadata}${commentBlocks}`;
  }

  return `{--${content}--}${
    useEndmatter
      ? `{#${change.changeId}}`
      : serializeChangeMetadata({
          ...change,
          kind: "deletion",
        })
  }${commentBlocks}`;
}

function addCriticChangeRule(
  service: TurndownService,
  comments: Map<string, CriticComment>,
  useEndmatter = false,
) {
  service.addRule("criticChange", {
    filter: (node) =>
      node.nodeName === "SPAN" &&
      (node as HTMLElement).hasAttribute("data-critic-change-kind"),
    replacement(content, node) {
      const element = node as HTMLElement;
      return serializeCriticChangeElement(
        service,
        element,
        content,
        comments,
        [],
        useEndmatter,
      );
    },
  });
}

function createCriticMarked(
  markdownOptions?: MarkdownOptions,
  endmatter?: ParsedEndmatter,
) {
  const comments = new Map<string, CriticComment>();
  const changes = new Map<string, CriticChangeAttrs>();
  const renderer = createMarkedRenderer(markdownOptions);
  renderer.code = (token) => renderCriticCodeBlock(token, comments, endmatter);
  const parser = new Marked({
    gfm: true,
    async: false,
    renderer,
  });

  parser.use({
    extensions: [
      {
        name: "criticCommentAnchor",
        level: "inline",
        start(src: string) {
          return src.indexOf("{==");
        },
        tokenizer(this: TokenizerThis, src: string) {
          const result = tokenizeCriticCommentAnchor(
            this.lexer,
            src,
            comments.values(),
            endmatter,
          );
          if (!result) return undefined;

          for (const comment of result.comments) {
            comments.set(comment.id, comment);
          }
          return result.token;
        },
        renderer(this: RendererThis, token: Tokens.Generic) {
          const criticToken = token as CriticCommentToken;
          return `<span data-comment-ids="${escapeHtml(
            JSON.stringify(criticToken.commentIds),
          )}">${this.parser.parseInline(criticToken.tokens)}</span>`;
        },
        childTokens: ["tokens"],
      } satisfies TokenizerAndRendererExtension,
      {
        name: "criticStandaloneComment",
        level: "inline",
        start(src: string) {
          return src.indexOf("{>>");
        },
        tokenizer(src: string) {
          const result = tokenizeCriticStandaloneComment(
            src,
            comments.values(),
            endmatter,
          );
          if (!result) return undefined;

          for (const comment of result.comments) {
            comments.set(comment.id, comment);
          }
          return result.token;
        },
        renderer(token: Tokens.Generic) {
          const criticToken = token as CriticStandaloneCommentToken;
          return `<span data-comment-ids="${escapeHtml(
            JSON.stringify(criticToken.commentIds),
          )}" data-comment-anchorless="true">${unanchoredCommentSentinel}</span>`;
        },
      } satisfies TokenizerAndRendererExtension,
      {
        name: "criticChange",
        level: "inline",
        start(src: string) {
          const starts = ["{++", "{--", "{~~"]
            .map((marker) => src.indexOf(marker))
            .filter((index) => index >= 0);

          return starts.length > 0 ? Math.min(...starts) : undefined;
        },
        tokenizer(this: TokenizerThis, src: string) {
          const result = tokenizeCriticChange(
            this.lexer,
            src,
            changes.values(),
            comments.values(),
            endmatter,
          );
          if (!result) return undefined;

          for (const comment of result.comments) {
            comments.set(comment.id, comment);
          }
          changes.set(result.token.change.changeId, result.token.change);
          return result.token;
        },
        renderer(this: RendererThis, token: Tokens.Generic) {
          const criticToken = token as CriticChangeToken;

          if (criticToken.change.kind === "substitution-old") {
            const oldContent = this.parser.parseInline(
              criticToken.oldTokens ?? [],
            );
            const newContent = this.parser.parseInline(
              criticToken.newTokens ?? [],
            );
            const substitutionHtml = `${renderCriticChangeSpan(
              criticToken.change,
              oldContent,
              "substitution-old",
            )}${renderCriticChangeSpan(
              criticToken.change,
              newContent,
              "substitution-new",
            )}`;

            if (criticToken.commentIds.length === 0) {
              return substitutionHtml;
            }

            return `<span data-comment-ids="${escapeHtml(
              JSON.stringify(criticToken.commentIds),
            )}">${substitutionHtml}</span>`;
          }

          return renderCriticChangeSpan(
            criticToken.change,
            this.parser.parseInline(criticToken.tokens ?? []),
            criticToken.change.kind,
            criticToken.commentIds,
          );
        },
        childTokens: ["tokens", "oldTokens", "newTokens"],
      } satisfies TokenizerAndRendererExtension,
    ],
  });

  return { parser, comments, changes };
}

export function criticMarkdownHasReviewRail(
  markdown: string,
  options?: MarkdownOptions,
): boolean {
  const { body, endmatter } = splitYamlDocumentMetadata(markdown);
  const normalized = normalizeLegacyMultilineComments(
    body,
    parseReviewEndmatter(endmatter),
  );
  const { parser, comments, changes } = createCriticMarked(
    options,
    normalized.parsedEndmatter,
  );
  parser.parse(protectRichTextRoundTripMarkdown(normalized.body));
  addEndmatterFeedback(comments, normalized.parsedEndmatter);
  return comments.size > 0 || changes.size > 0;
}

export function criticMarkdownToRenderedHtml(
  markdown: string,
  options?: MarkdownOptions,
): {
  html: string;
  comments: Map<string, CriticComment>;
  changes: Map<string, CriticChangeAttrs>;
  frontmatter: string | null;
  endmatter: string | null;
} {
  const { frontmatter, body, endmatter } = splitYamlDocumentMetadata(markdown);
  const normalized = normalizeLegacyMultilineComments(
    body,
    parseReviewEndmatter(endmatter),
  );
  const { parser, comments, changes } = createCriticMarked(
    options,
    normalized.parsedEndmatter,
  );
  const html = parser.parse(
    protectRichTextRoundTripMarkdown(normalized.body),
  ) as string;
  addEndmatterFeedback(comments, normalized.parsedEndmatter);

  return {
    html,
    comments,
    changes,
    frontmatter,
    endmatter: normalized.endmatter ?? endmatter,
  };
}

export function criticMarkdownToEditorState(
  markdown: string,
  options?: MarkdownOptions,
): {
  doc: JSONContent;
  comments: Map<string, CriticComment>;
  frontmatter: string | null;
  endmatter: string | null;
} {
  const { frontmatter, body, endmatter } = splitYamlDocumentMetadata(markdown);
  const normalized = normalizeLegacyMultilineComments(
    body,
    parseReviewEndmatter(endmatter),
  );
  const { parser, comments } = createCriticMarked(
    options,
    normalized.parsedEndmatter,
  );
  const html = parser.parse(
    protectRichTextRoundTripMarkdown(normalized.body),
  ) as string;
  const doc = generateJSON(html, extensions) as JSONContent & {
    yamlFrontmatter?: string;
    yamlEndmatter?: string;
  };
  addEndmatterFeedback(comments, normalized.parsedEndmatter);
  if (frontmatter) {
    doc.yamlFrontmatter = frontmatter;
  }
  const outputEndmatter = normalized.endmatter ?? endmatter;
  if (outputEndmatter) {
    doc.yamlEndmatter = outputEndmatter;
  }

  return { doc, comments, frontmatter, endmatter: outputEndmatter };
}

function collectCriticChangesFromDoc(
  doc: JSONContent,
): Map<string, CriticChangeAttrs> {
  const changes = new Map<string, CriticChangeAttrs>();
  const visit = (node: JSONContent) => {
    for (const mark of node.marks ?? []) {
      if (mark.type !== "criticChange") continue;

      const attrs = mark.attrs as Partial<CriticChangeAttrs> | undefined;
      if (
        attrs?.changeId &&
        attrs.kind &&
        attrs.createdAt &&
        attrs.authorType
      ) {
        changes.set(attrs.changeId, {
          kind: attrs.kind,
          changeId: attrs.changeId,
          createdAt: attrs.createdAt,
          authorType: attrs.authorType,
          authorId: attrs.authorId ?? null,
        });
      }
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  };

  visit(doc);
  return changes;
}

export function editorStateToCriticMarkdown(
  doc: JSONContent,
  comments: Map<string, CriticComment>,
  options?: { frontmatter?: string | null; endmatter?: string | null },
): string {
  const html = generateHTML(doc, extensions);
  const service = createTurndownService();
  const frontmatter =
    options?.frontmatter ??
    (doc as JSONContent & { yamlFrontmatter?: string }).yamlFrontmatter ??
    null;
  const sourceEndmatter =
    options?.endmatter ??
    (doc as JSONContent & { yamlEndmatter?: string }).yamlEndmatter ??
    null;
  const changes = collectCriticChangesFromDoc(doc);
  const useEndmatter = Boolean(sourceEndmatter);
  addCriticCommentRule(service, comments, useEndmatter);
  addCriticChangeRule(service, comments, useEndmatter);
  addCriticCodeBlockRule(service);
  const endmatter = serializeReviewEndmatter(
    sourceEndmatter,
    comments,
    changes,
  );
  return appendYamlEndmatter(
    prependYamlFrontmatter(
      normalizeBlockSpacing(`${service.turndown(html).trimEnd()}\n`),
      frontmatter,
    ),
    endmatter,
  );
}

export function createCriticComment(
  partial?: Partial<CriticComment>,
  options?: {
    existingComments?: Iterable<Pick<CriticComment, "id">>;
  },
): CriticComment {
  return createCommentWithContext(partial, options?.existingComments);
}

export function createCriticChange(
  kind: CriticChangeKind,
  partial?: Partial<CriticChangeAttrs>,
  options?: {
    existingChanges?: Iterable<Pick<CriticChangeAttrs, "changeId">>;
  },
): CriticChangeAttrs {
  return createChangeWithContext(kind, partial, options?.existingChanges);
}
