import type {
  BackendInfo,
  Page,
  StorageBackend,
  StoredAsset,
  VoiceActionResult,
  VoiceSelectionSnapshot,
} from "./storage";

const PAGES_KEY = "roughdraft:pages";
const ASSETS_KEY = "roughdraft:assets";

interface LocalAssetRecord {
  path: string;
  dataUrl: string;
  mimeType: string;
}

function readPages(): Record<string, Page> {
  try {
    const raw = localStorage.getItem(PAGES_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function writePages(pages: Record<string, Page>): void {
  localStorage.setItem(PAGES_KEY, JSON.stringify(pages));
}

function readAssets(): Record<string, LocalAssetRecord> {
  try {
    const raw = localStorage.getItem(ASSETS_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // ignore
  }
  return {};
}

function writeAssets(assets: Record<string, LocalAssetRecord>): void {
  localStorage.setItem(ASSETS_KEY, JSON.stringify(assets));
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function nextAssetPath(
  assets: Record<string, LocalAssetRecord>,
  filename: string,
): string {
  const safeName = sanitizeFilename(filename);
  const dotIndex = safeName.lastIndexOf(".");
  const basename = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  let counter = 0;

  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const path = `./.roughdraft-assets/${basename}${suffix}${extension}`;
    if (!assets[path]) return path;
    counter += 1;
  }
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function normalizeAssetPath(input: string): string {
  if (input.startsWith("./")) return input;
  return `./${input.replace(/^\/+/, "")}`;
}

export class LocalStorageBackend implements StorageBackend {
  info: BackendInfo = {
    kind: "local-storage",
    label: "Browser storage",
    detail: "Saved in this browser only",
  };
  canManageProjects = false;

  private async getPage(id: string): Promise<Page> {
    const pages = readPages();
    const page = pages[id];
    if (!page) throw new Error(`Page not found: ${id}`);
    return page;
  }

  async getMarkdownFile(relativePath: string): Promise<Page> {
    const id = relativePath.replace(/\.md$/i, "");
    return this.getPage(id);
  }

  private async savePage(id: string, content: string): Promise<void> {
    const pages = readPages();
    if (!pages[id]) throw new Error(`Page not found: ${id}`);
    pages[id].content = content;
    const firstLine = content.split("\n")[0] || "";
    pages[id].title = firstLine.replace(/^#*\s*/, "") || id;
    writePages(pages);
  }

  async saveMarkdownFile(
    relativePath: string,
    content: string,
  ): Promise<undefined> {
    const id = relativePath.replace(/\.md$/i, "");
    await this.savePage(id, content);
    return undefined;
  }

  async completeReview(_relativePath: string): Promise<{ delivered: boolean }> {
    return { delivered: false };
  }

  async processVoiceUtterance(
    _relativePath: string,
    utterance: string,
    _selection: VoiceSelectionSnapshot,
  ): Promise<VoiceActionResult> {
    return {
      action: "comment",
      content: utterance.trim(),
      confidence: 0.3,
      uncertain: true,
    };
  }

  async saveAsset(file: File): Promise<StoredAsset> {
    const assets = readAssets();
    const markdownPath = nextAssetPath(assets, file.name);
    const dataUrl = await fileToDataUrl(file);

    assets[markdownPath] = {
      path: markdownPath,
      dataUrl,
      mimeType: file.type || "application/octet-stream",
    };
    writeAssets(assets);

    return {
      markdownPath,
      previewUrl: dataUrl,
      mimeType: file.type || "application/octet-stream",
    };
  }

  resolveFileUrl(path: string): string | null {
    const assets = readAssets();
    const normalized = normalizeAssetPath(path);
    return assets[normalized]?.dataUrl ?? null;
  }

  async openProject(_path: string): Promise<void> {
    throw new Error(
      "Local file access is unavailable in browser storage mode.",
    );
  }
}
