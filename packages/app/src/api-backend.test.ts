import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiBackend } from "./api-backend";

describe("ApiBackend", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("lists only Markdown files from the project tree", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            paths: [
              "docs/",
              "docs/STATUS.md",
              "README.md",
              "notes.txt",
              ".roughdraft-assets/sketch.png",
            ],
          }),
          { status: 200 },
        ),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const backend = new ApiBackend({
      kind: "local-files",
      label: "Local files",
      detail: "/work",
      projectPath: "/work",
    });

    await expect(backend.listProjectMarkdownFiles()).resolves.toEqual([
      { path: "README.md" },
      { path: "docs/STATUS.md" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/file-tree?projectPath=%2Fwork",
    );
  });
});
