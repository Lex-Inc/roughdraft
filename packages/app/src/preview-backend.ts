import type {
  BackendInfo,
  Page,
  StorageBackend,
  StoredAsset,
  VoiceActionResult,
  VoiceSelectionSnapshot,
} from "./storage";

function titleFromContent(content: string, fallback: string) {
  const firstLine = content.split("\n")[0] || "";
  return firstLine.replace(/^#*\s*/, "").trim() || fallback;
}

function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  return trimmed.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function nextAssetPath(assets: Map<string, string>, filename: string): string {
  const safeName = sanitizeFilename(filename);
  const dotIndex = safeName.lastIndexOf(".");
  const basename = dotIndex > 0 ? safeName.slice(0, dotIndex) : safeName;
  const extension = dotIndex > 0 ? safeName.slice(dotIndex) : "";
  let counter = 0;

  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const path = `./.roughdraft-preview-assets/${basename}${suffix}${extension}`;
    if (!assets.has(path)) return path;
    counter += 1;
  }
}

export class PreviewBackend implements StorageBackend {
  info: BackendInfo = {
    kind: "local-storage",
    label: "Live preview",
    detail: "In memory only",
  };
  canManageProjects = false;

  private page: Page;
  private assets = new Map<string, string>();

  constructor(page: Page) {
    this.page = page;
  }

  getCurrentPage(): Page {
    return this.page;
  }

  async getMarkdownFile(_relativePath: string): Promise<Page> {
    return this.page;
  }

  async saveMarkdownFile(
    _relativePath: string,
    content: string,
  ): Promise<Page> {
    this.page = {
      ...this.page,
      title: titleFromContent(content, this.page.id),
      content,
      version: `memory:${Date.now()}`,
    };

    return this.page;
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
    const markdownPath = nextAssetPath(this.assets, file.name);
    const previewUrl = URL.createObjectURL(file);
    this.assets.set(markdownPath, previewUrl);

    return {
      markdownPath,
      previewUrl,
      mimeType: file.type || "application/octet-stream",
    };
  }

  resolveFileUrl(path: string): string | null {
    const normalized = path.startsWith("./")
      ? path
      : `./${path.replace(/^\/+/, "")}`;
    return this.assets.get(normalized) ?? null;
  }

  async openProject(_path: string): Promise<void> {
    return;
  }

  dispose(): void {
    for (const previewUrl of this.assets.values()) {
      URL.revokeObjectURL(previewUrl);
    }
    this.assets.clear();
  }
}
