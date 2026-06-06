import {
  type BackendInfo,
  type CompleteReviewOptions,
  type CompleteReviewResult,
  type MarkdownFileChangeEvent,
  MarkdownFileConflictError,
  type Page,
  type ProjectMarkdownFile,
  type ReviewWatchStatus,
  type StorageBackend,
  type StoredAsset,
} from "./storage";

export class ApiBackend implements StorageBackend {
  info: BackendInfo;
  canManageProjects = true;

  constructor(info: BackendInfo) {
    this.info = info;
  }

  private updateProjectInfo(projectPath?: string): void {
    this.info = {
      ...this.info,
      detail: projectPath || "Markdown file on disk",
      projectPath,
    };
  }

  private buildUrl(route: string, params?: Record<string, string>): string {
    const url = new URL(route, window.location.origin);
    const projectPath = this.info.projectPath?.trim();

    if (projectPath) {
      url.searchParams.set("projectPath", projectPath);
    }

    Object.entries(params ?? {}).forEach(([key, value]) => {
      url.searchParams.set(key, value);
    });

    return `${url.pathname}${url.search}`;
  }

  async getMarkdownFile(relativePath: string): Promise<Page> {
    const res = await fetch(
      this.buildUrl("/api/markdown-file", {
        path: relativePath,
      }),
    );
    if (!res.ok) {
      throw new Error(
        `Failed to get markdown file ${relativePath}: ${res.status}`,
      );
    }
    return res.json();
  }

  async saveMarkdownFile(
    relativePath: string,
    content: string,
    expectedVersion?: string,
  ): Promise<Page> {
    const res = await fetch(
      this.buildUrl("/api/markdown-file", { path: relativePath }),
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content,
          expectedVersion,
          projectPath: this.info.projectPath,
        }),
      },
    );
    if (res.status === 409) {
      const payload = (await res.json()) as { current?: Page };
      if (payload.current) {
        throw new MarkdownFileConflictError(payload.current);
      }
    }
    if (!res.ok) {
      throw new Error(
        `Failed to save markdown file ${relativePath}: ${res.status}`,
      );
    }
    return res.json();
  }

  watchMarkdownFile(
    relativePath: string,
    onChange: (event: MarkdownFileChangeEvent) => void,
  ): () => void {
    const source = new EventSource(
      this.buildUrl("/api/markdown-file/events", { path: relativePath }),
    );

    source.addEventListener("change", (event) => {
      try {
        onChange(JSON.parse((event as MessageEvent<string>).data));
      } catch (error) {
        console.error("Failed to read markdown file change event:", error);
      }
    });

    source.onerror = (error) => {
      console.error("Markdown file event stream failed:", error);
    };

    return () => {
      source.close();
    };
  }

  async completeReview(
    relativePath: string,
    options: CompleteReviewOptions = {},
  ): Promise<CompleteReviewResult> {
    const overallComment = options.overallComment?.trim();
    const res = await fetch(
      this.buildUrl("/api/review-events", { path: relativePath }),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectPath: this.info.projectPath,
          path: relativePath,
          ...(overallComment ? { overallComment } : {}),
        }),
      },
    );

    if (!res.ok) {
      throw new Error(
        `Failed to complete review ${relativePath}: ${res.status}`,
      );
    }

    const payload = (await res.json()) as { delivered?: unknown };
    return { delivered: payload.delivered === true };
  }

  async getReviewWatchStatus(relativePath: string): Promise<ReviewWatchStatus> {
    const res = await fetch(
      this.buildUrl("/api/review-events/status", { path: relativePath }),
    );

    if (!res.ok) {
      throw new Error(
        `Failed to get review watch status ${relativePath}: ${res.status}`,
      );
    }

    const payload = (await res.json()) as {
      watching?: unknown;
      watcherCount?: unknown;
    };
    return {
      watching: payload.watching === true,
      watcherCount:
        typeof payload.watcherCount === "number" ? payload.watcherCount : 0,
    };
  }

  async listProjectMarkdownFiles(): Promise<ProjectMarkdownFile[]> {
    const res = await fetch(this.buildUrl("/api/file-tree"));
    if (!res.ok) {
      throw new Error(`Failed to list project markdown files: ${res.status}`);
    }

    const payload = (await res.json()) as { paths?: unknown };
    const paths = Array.isArray(payload.paths) ? payload.paths : [];
    return paths
      .filter(
        (path): path is string =>
          typeof path === "string" &&
          !path.endsWith("/") &&
          path.toLowerCase().endsWith(".md"),
      )
      .sort(
        (left, right) =>
          left.split("/").length - right.split("/").length ||
          left.localeCompare(right, undefined, { numeric: true }),
      )
      .map((path) => ({ path }));
  }

  async saveAsset(file: File): Promise<StoredAsset> {
    const buffer = await file.arrayBuffer();
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index];
      if (byte === undefined) continue;
      binary += String.fromCharCode(byte);
    }

    const res = await fetch(this.buildUrl("/api/assets"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type || "application/octet-stream",
        dataBase64: btoa(binary),
        projectPath: this.info.projectPath,
      }),
    });

    if (!res.ok) throw new Error(`Failed to save asset: ${res.status}`);
    return res.json();
  }

  resolveFileUrl(path: string): string | null {
    const normalized = path.replace(/^\.?\//, "");
    return this.buildUrl("/api/files", { path: normalized });
  }

  async openProject(path: string): Promise<void> {
    this.updateProjectInfo(path);
  }
}
