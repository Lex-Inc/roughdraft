import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildLocationForDocumentEditorViewMode,
  type DocumentEditorViewMode,
  getDocumentEditorViewModeFromLocation,
} from "../src/app-navigation";
import {
  DocumentSaveStatusIndicator,
  DocumentWorkspace,
  getReviewHandoffButtonLabel,
  isReviewHandoffDisabled,
  shouldLatchDocumentChangedSinceOpen,
} from "../src/DocumentWorkspace";
import type { DocumentSaveState } from "../src/PageCard";
import type {
  CompleteReviewOptions,
  CompleteReviewResult,
  Page,
  StorageBackend,
} from "../src/storage";

function createBackend({
  watcherCount,
}: {
  watcherCount?: number;
} = {}): StorageBackend {
  const backend: StorageBackend = {
    info: {
      kind: "local-storage",
      label: "Test backend",
      detail: "In-memory",
    },
    canManageProjects: false,
    async getMarkdownFile(relativePath) {
      return { id: relativePath, title: relativePath, content: "" };
    },
    async saveMarkdownFile() {
      return undefined;
    },
    async saveAsset(file) {
      return {
        markdownPath: file.name,
        previewUrl: `file://${file.name}`,
        mimeType: file.type || "application/octet-stream",
      };
    },
    resolveFileUrl(path) {
      return `file://${path}`;
    },
    async openProject() {},
  };

  if (watcherCount !== undefined) {
    backend.getReviewWatchStatus = async () => ({
      watching: watcherCount > 0,
      watcherCount,
    });
  }

  return backend;
}

function createPage(content = "Hello world"): Page {
  return {
    id: "test-doc",
    title: "Test Doc",
    content,
  };
}

function setupDomMocks() {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    width: 640,
    height: 480,
    right: 640,
    bottom: 480,
    toJSON() {
      return this;
    },
  } as DOMRect);

  if (!("ResizeObserver" in globalThis)) {
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      value: class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
  }

  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });

  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value() {
      return {
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        width: 80,
        height: 20,
        right: 80,
        bottom: 20,
        toJSON() {
          return this;
        },
      } as DOMRect;
    },
  });

  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [
        {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: 80,
          height: 20,
          right: 80,
          bottom: 20,
          toJSON() {
            return this;
          },
        } as DOMRect,
      ];
    },
  });

  Object.defineProperty(HTMLElement.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [this.getBoundingClientRect()];
    },
  });

  Object.defineProperty(Text.prototype, "getClientRects", {
    configurable: true,
    value() {
      return [
        {
          x: 0,
          y: 0,
          left: 0,
          top: 0,
          width: 80,
          height: 20,
          right: 80,
          bottom: 20,
          toJSON() {
            return this;
          },
        } as DOMRect,
      ];
    },
  });

  window.scrollBy = vi.fn();
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

async function change(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();
  });
}

function queryByTestId<T extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
) {
  return container.querySelector<T>(`[data-testid="${testId}"]`);
}

function getByTestId<T extends Element = HTMLElement>(
  container: ParentNode,
  testId: string,
) {
  const element = queryByTestId<T>(container, testId);
  expect(element).not.toBeNull();
  return element as T;
}

describe("view mode toggle uses client-side state (issue 1 fix)", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("buildLocationForDocumentEditorViewMode produces a URL for history.replaceState", () => {
    window.history.replaceState(
      null,
      "",
      "/?path=/test/doc.md&editor=rich-text",
    );

    const nextLocation = buildLocationForDocumentEditorViewMode("code");

    expect(nextLocation).toContain("editor=code");
    expect(typeof nextLocation).toBe("string");
  });

  it("view mode can be read from the URL query param", () => {
    window.history.replaceState(null, "", "/?editor=rich-text");
    expect(getDocumentEditorViewModeFromLocation("rich-text")).toBe(
      "rich-text",
    );

    window.history.replaceState(null, "", "/?editor=code");
    expect(getDocumentEditorViewModeFromLocation("rich-text")).toBe("code");
  });

  it("buildLocationForDocumentEditorViewMode returns the expected path+search", () => {
    window.history.replaceState(null, "", "/doc.md?editor=rich-text");

    const result = buildLocationForDocumentEditorViewMode("code");

    expect(result).toBe("/doc.md?editor=code");
  });
});

describe("saving/saved status indicator (issue 2 fix)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setupDomMocks();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    Reflect.deleteProperty(globalThis, "ClipboardItem");
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function renderSaveStatus({
    saveState = "saved",
    documentDiskChangeState = "clean",
  }: {
    saveState?: DocumentSaveState;
    documentDiskChangeState?: "clean" | "changed" | "conflict" | "paused";
  } = {}) {
    await act(async () => {
      root.render(
        <DocumentSaveStatusIndicator
          saveState={saveState}
          diskChangeState={documentDiskChangeState}
        />,
      );
      await Promise.resolve();
    });
  }

  async function renderWorkspace({
    documentDiskChangeState = "clean",
    documentContent = "Hello world",
    documentCopyPath = "test.md",
    watcherCount = 0,
    onSaveDocument = async () => {},
  }: {
    documentDiskChangeState?: "clean" | "changed" | "conflict" | "paused";
    documentContent?: string;
    documentCopyPath?: string | null;
    watcherCount?: number;
    onSaveDocument?: (id: string, content: string) => Promise<void>;
  } = {}) {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    await act(async () => {
      root.render(
        <DocumentWorkspace
          documentPage={createPage(documentContent)}
          activeDocumentPath="test.md"
          documentCopyPath={documentCopyPath}
          documentFilenameLabel="test.md"
          documentEditorViewMode="rich-text"
          onDocumentEditorViewModeChange={() => {}}
          onSaveDocument={onSaveDocument}
          onDocumentSaveStateChange={() => {}}
          onDocumentDirtyStateChange={() => {}}
          onDocumentLocalContentChange={() => {}}
          documentDiskChangeState={documentDiskChangeState}
          documentForceResetKey={null}
          onReloadDocumentFromDisk={() => {}}
          onKeepEditingWithoutAutosave={() => {}}
          onOverwriteDocumentOnDisk={() => {}}
          onCompleteReview={async () => ({ delivered: false })}
          backend={createBackend({ watcherCount })}
        />,
      );
      await Promise.resolve();
    });
  }

  async function openFileMenu() {
    await click(getByTestId(container, "document-file-menu-trigger"));
    return getByTestId(document.body, "document-file-menu");
  }

  it.each([
    ["saved", "Saved", "document-save-status-saved"],
    ["saving", "Saving", "animate-spin"],
    ["unsaved", "Unsaved changes", "animate-spin"],
    ["error", "Save failed", ""],
  ] satisfies Array<
    [DocumentSaveState, string, string]
  >)("shows icon-only %s save status", async (saveState, label, iconClass) => {
    await renderSaveStatus({ saveState });

    const status = getByTestId(container, "document-save-status");
    expect(status.getAttribute("aria-label")).toBe(label);
    expect(status.textContent).toBe("");
    const icon = getByTestId(status, "document-save-status-icon");
    if (iconClass) {
      expect(icon.classList.contains(iconClass)).toBe(true);
    }
  });

  it.each([
    ["changed", "File changed on disk"],
    ["conflict", "Save conflict"],
    ["paused", "Autosave paused"],
  ] as const)("shows disk-blocked %s save status", async (state, label) => {
    await renderSaveStatus({ documentDiskChangeState: state });

    const status = getByTestId(container, "document-save-status");
    expect(status.getAttribute("aria-label")).toBe(label);
    expect(status.textContent).toBe("");
    expect(getByTestId(status, "document-save-status-icon")).not.toBeNull();
  });

  it("renders save status in the fixed corner when handoff exists", async () => {
    await renderWorkspace({ watcherCount: 1 });

    const stack = queryByTestId(container, "document-status-stack");
    const header = getByTestId(container, "document-page-header");
    const corner = getByTestId(container, "document-save-status-corner");
    const doneReviewingButton = queryByTestId(
      container,
      "review-handoff-button",
    );
    expect(stack).not.toBeNull();
    expect(doneReviewingButton).toBeDefined();
    expect(doneReviewingButton?.textContent).toContain("Approve");
    expect(doneReviewingButton?.textContent).not.toContain("Saved");
    expect(stack?.textContent).not.toContain("Saved");
    expect(header.textContent).toContain("test.md");
    expect(header.textContent).not.toContain("Saved");
    expect(queryByTestId(header, "document-save-status")).toBeNull();
    expect(
      getByTestId(corner, "document-save-status").getAttribute("aria-label"),
    ).toBe("Saved");
  });

  it("renders save status in the fixed corner without handoff", async () => {
    await renderWorkspace();

    const stack = queryByTestId(container, "document-status-stack");
    const header = getByTestId(container, "document-page-header");
    const corner = getByTestId(container, "document-save-status-corner");
    expect(stack).not.toBeNull();
    expect(stack?.textContent).not.toContain("I'm done");
    expect(stack?.textContent).not.toContain("Saved");
    expect(header.textContent).toContain("test.md");
    expect(header.textContent).not.toContain("Saved");
    expect(queryByTestId(header, "document-save-status")).toBeNull();
    expect(
      getByTestId(corner, "document-save-status").getAttribute("aria-label"),
    ).toBe("Saved");
  });

  it.each([
    ["path", "/Users/me/project/test.md"],
    ["filename", "test.md"],
    ["markdown", "# Heading\n\nBody"],
  ] as const)("copies document %s from the file menu", async (action, text) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await renderWorkspace({
      documentContent: "# Heading\n\nBody",
      documentCopyPath: "/Users/me/project/test.md",
    });
    await openFileMenu();
    await click(getByTestId(document.body, `document-file-menu-${action}`));

    expect(writeText).toHaveBeenCalledWith(text);
  });

  it("keeps the file menu open and shows temporary copied feedback", async () => {
    vi.useFakeTimers();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    await renderWorkspace({ documentContent: "# Heading\n\nBody" });
    await openFileMenu();
    await click(getByTestId(document.body, "document-file-menu-path"));

    const menu = getByTestId(document.body, "document-file-menu");
    expect(menu.textContent).toContain("Copied!");
    expect(menu.textContent).not.toContain("Copy:");

    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(
      getByTestId(document.body, "document-file-menu").textContent,
    ).toContain("Path");
    vi.useRealTimers();
  });

  it("shows copy previews below each file menu action", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    await renderWorkspace({ documentContent: "# Heading\n\nBody" });
    await openFileMenu();

    const menu = getByTestId(document.body, "document-file-menu");
    expect(menu.textContent).toContain("Path");
    expect(menu.textContent).toContain("test.md");
    expect(menu.textContent).toContain("Filename");
    expect(menu.textContent).toContain("Markdown");
    expect(menu.textContent).toContain("# Heading Body");
    expect(menu.textContent).toContain("Rich text");
    const richTextAction = getByTestId(
      document.body,
      "document-file-menu-rich-text",
    );
    expect(richTextAction.textContent).toContain("Heading Body");
    expect(richTextAction.textContent).not.toContain("# Heading");
  });

  it("copies document rich text with html and plain markdown flavors", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardItems: Array<Record<string, Blob>> = [];
    class ClipboardItemMock {
      items: Record<string, Blob>;

      constructor(items: Record<string, Blob>) {
        this.items = items;
        clipboardItems.push(items);
      }
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: ClipboardItemMock,
    });

    await renderWorkspace({ documentContent: "# Heading\n\nBody" });
    await openFileMenu();
    await click(getByTestId(document.body, "document-file-menu-rich-text"));

    expect(clipboardItems).toHaveLength(1);
    expect(clipboardItems[0]).toEqual({
      "text/html": expect.any(Blob),
      "text/plain": expect.any(Blob),
    });
    await expect(clipboardItems[0]["text/html"].text()).resolves.toContain(
      "<h1>Heading</h1>",
    );
    await expect(clipboardItems[0]["text/plain"].text()).resolves.toBe(
      "Heading\nBody",
    );
    expect(write).toHaveBeenCalledWith([
      expect.objectContaining({ items: expect.any(Object) }),
    ]);
  });

  it("strips comments and suggestions from copied rich text", async () => {
    const write = vi.fn().mockResolvedValue(undefined);
    const clipboardItems: Array<Record<string, Blob>> = [];
    class ClipboardItemMock {
      items: Record<string, Blob>;

      constructor(items: Record<string, Blob>) {
        this.items = items;
        clipboardItems.push(items);
      }
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { write },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      value: ClipboardItemMock,
    });

    await renderWorkspace({
      documentContent:
        'Keep {==the launch date==}{>>Verify this.<<}{#c1}, omit {++new claim++}{#s1}, keep {--old claim--}{#s2}, and use {~~rough~>polished~~}{#s3} wording.\n\n{>>Standalone note<<}{#c2}\n\n---\ncomments:\n  c1:\n    by: user\n    at: "2026-04-28T12:00:00.000Z"\n  c2:\n    by: user\n    at: "2026-04-28T12:01:00.000Z"\nsuggestions:\n  s1:\n    by: AI\n    at: "2026-04-28T12:02:00.000Z"\n  s2:\n    by: AI\n    at: "2026-04-28T12:03:00.000Z"\n  s3:\n    by: AI\n    at: "2026-04-28T12:04:00.000Z"\n',
    });
    await openFileMenu();
    await click(getByTestId(document.body, "document-file-menu-rich-text"));

    const html = await clipboardItems[0]["text/html"].text();
    const plain = await clipboardItems[0]["text/plain"].text();

    expect(html).toContain("Keep the launch date");
    expect(html).toContain("old claim");
    expect(html).toContain("rough");
    expect(html).not.toContain("Verify this");
    expect(html).not.toContain("Standalone note");
    expect(html).not.toContain("new claim");
    expect(html).not.toContain("polished");
    expect(html).not.toContain("data-comment-ids");
    expect(html).not.toContain("data-critic-change-kind");
    expect(plain).toBe(
      "Keep the launch date, omit , keep old claim, and use rough wording.",
    );
  });

  it.each([
    ["Meta+S", { key: "s", metaKey: true }],
    ["Control+S", { key: "s", ctrlKey: true }],
  ])("prevents browser save on %s", async (_label, init) => {
    const onSaveDocument = vi.fn().mockResolvedValue(undefined);
    await renderWorkspace({ onSaveDocument });

    const event = new KeyboardEvent("keydown", {
      ...init,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");

    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(preventDefault).toHaveBeenCalled();
  });

  it("prevents browser save even when disk conflict blocks persistence", async () => {
    const onSaveDocument = vi.fn().mockResolvedValue(undefined);
    await renderWorkspace({
      documentDiskChangeState: "conflict",
      onSaveDocument,
    });

    const event = new KeyboardEvent("keydown", {
      key: "s",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    const preventDefault = vi.spyOn(event, "preventDefault");

    await act(async () => {
      window.dispatchEvent(event);
      await Promise.resolve();
    });

    expect(preventDefault).toHaveBeenCalled();
    expect(onSaveDocument).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Save conflict");
  });

  it("shows conflict status without replacing the existing conflict banner", async () => {
    await renderWorkspace({ documentDiskChangeState: "conflict" });

    expect(container.textContent).toContain("Save conflict");
    expect(container.textContent).toContain("This file changed on disk");
    expect(
      getByTestId(container, "document-save-status").getAttribute("aria-label"),
    ).toBe("Save conflict");
  });

  it.each([
    ["error", "clean"],
    ["saved", "conflict"],
  ] satisfies Array<
    [DocumentSaveState, "clean" | "changed" | "conflict" | "paused"]
  >)("keeps handoff disabled for save state %s and disk state %s", (saveState, documentDiskChangeState) => {
    expect(
      isReviewHandoffDisabled({
        saveState,
        documentDiskChangeState,
        reviewHandoffState: "idle",
      }),
    ).toBe(true);
  });

  it.each([
    "saving",
    "unsaved",
  ] satisfies DocumentSaveState[])("keeps handoff enabled while a debounced save is pending (save state %s)", (saveState) => {
    // The button must not dim on every keystroke while autosave debounces; it
    // stays enabled and flushes the pending save on click instead.
    expect(
      isReviewHandoffDisabled({
        saveState,
        documentDiskChangeState: "clean",
        reviewHandoffState: "idle",
      }),
    ).toBe(false);
  });

  it("allows handoff when saved, conflict-free, and idle", () => {
    expect(
      isReviewHandoffDisabled({
        saveState: "saved",
        documentDiskChangeState: "clean",
        reviewHandoffState: "idle",
      }),
    ).toBe(false);
  });

  it("uses approve copy until the user has changed the document", () => {
    expect(
      getReviewHandoffButtonLabel({
        reviewHandoffState: "idle",
        documentChangedSinceOpen: false,
      }),
    ).toBe("Approve");
    expect(
      getReviewHandoffButtonLabel({
        reviewHandoffState: "idle",
        documentChangedSinceOpen: true,
      }),
    ).toBe("I'm done");
  });

  it("ignores initial editor dirty signals before user input is possible", () => {
    expect(
      shouldLatchDocumentChangedSinceOpen({
        isDirty: true,
        documentChangeTrackingReady: false,
      }),
    ).toBe(false);
    expect(
      shouldLatchDocumentChangedSinceOpen({
        isDirty: true,
        documentChangeTrackingReady: true,
      }),
    ).toBe(true);
  });
});

describe("interaction mode preserved across view toggle (issue 3 fix)", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setupDomMocks();
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    vi.restoreAllMocks();
  });

  it("interaction mode is preserved when view mode changes without remount", async () => {
    // With the fix, view mode changes use React state (no page reload),
    // so the DocumentWorkspace component stays mounted and interaction
    // mode is preserved.

    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;

    const renderWorkspace = async (viewMode: DocumentEditorViewMode) => {
      await act(async () => {
        root.render(
          <DocumentWorkspace
            documentPage={createPage()}
            activeDocumentPath="test.md"
            documentFilenameLabel="test.md"
            documentEditorViewMode={viewMode}
            onDocumentEditorViewModeChange={() => {}}
            onSaveDocument={async () => {}}
            onDocumentSaveStateChange={() => {}}
            onDocumentDirtyStateChange={() => {}}
            onDocumentLocalContentChange={() => {}}
            documentDiskChangeState="clean"
            documentForceResetKey={null}
            onReloadDocumentFromDisk={() => {}}
            onKeepEditingWithoutAutosave={() => {}}
            onOverwriteDocumentOnDisk={() => {}}
            onCompleteReview={async () => ({ delivered: false })}
            backend={createBackend()}
          />,
        );
      });
    };

    // Mount with rich-text -> mode is "Suggesting" by default
    await renderWorkspace("rich-text");
    expect(
      getByTestId(container, "document-mode-trigger").textContent,
    ).toContain("Suggesting");

    // Rerender with code view (same component instance, no remount) ->
    // mode stays "Suggesting" because the component is not destroyed.
    await renderWorkspace("code");
    expect(
      getByTestId(container, "document-mode-trigger").textContent,
    ).toContain("Suggesting");
  });
});

describe("review handoff watcher affordance", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    setupDomMocks();
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.replaceChildren();
    vi.restoreAllMocks();
    window.history.replaceState(null, "", "/");
  });

  async function renderWorkspace({
    getWatcherCount,
    onCompleteReview = async () => ({ delivered: false }),
  }: {
    getWatcherCount: () => number;
    onCompleteReview?: (
      options?: CompleteReviewOptions,
    ) => Promise<CompleteReviewResult>;
  }) {
    await act(async () => {
      root.render(
        <DocumentWorkspace
          documentPage={createPage()}
          activeDocumentPath="test.md"
          documentFilenameLabel="test.md"
          documentEditorViewMode="rich-text"
          onDocumentEditorViewModeChange={() => {}}
          onSaveDocument={async () => {}}
          onDocumentSaveStateChange={() => {}}
          onDocumentDirtyStateChange={() => {}}
          onDocumentLocalContentChange={() => {}}
          documentDiskChangeState="clean"
          documentForceResetKey={null}
          onReloadDocumentFromDisk={() => {}}
          onKeepEditingWithoutAutosave={() => {}}
          onOverwriteDocumentOnDisk={() => {}}
          onCompleteReview={onCompleteReview}
          backend={createBackend({ watcherCount: getWatcherCount() })}
        />,
      );
      await Promise.resolve();
    });
  }

  it("hides the done reviewing button when no agent is watching", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: false });

    await renderWorkspace({ getWatcherCount: () => 0, onCompleteReview });

    expect(container.textContent).not.toContain("Approve");
    expect(container.textContent).not.toContain("I'm done");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
    expect(onCompleteReview).not.toHaveBeenCalled();
  });

  it("shows the done reviewing button only for an active watcher", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    expect(doneReviewingButton).toBeDefined();
    expect(doneReviewingButton?.textContent).toContain("Approve");
    expect(container.textContent).not.toContain("Agent waiting");
    expect(queryByTestId(container, "review-handoff-status")).toBeNull();

    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(onCompleteReview).toHaveBeenCalledWith(undefined);
    expect(container.textContent).toContain("Sent");
    expect(queryByTestId(container, "review-handoff-status")).toBeNull();
    expect(container.textContent).not.toContain("Agent notified");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
  });

  it("fades the whole handoff split button after sending", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const splitButton = queryByTestId<HTMLDivElement>(
      container,
      "review-handoff-split-button",
    );
    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    const commentTrigger = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-comment-trigger",
    );
    if (!splitButton || !doneReviewingButton || !commentTrigger) {
      throw new Error("Review handoff split button not found");
    }

    await click(doneReviewingButton);

    expect(splitButton.className).toContain("opacity-50");
    expect(doneReviewingButton.className).toContain("disabled:opacity-100");
    expect(commentTrigger.className).toContain("disabled:opacity-100");
  });

  it("shows visible feedback when the watcher disappears before handoff delivery", async () => {
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: false });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Not sent");
    expect(container.textContent).not.toContain("Approve");
    expect(container.textContent).not.toContain("I'm done");
  });

  it("submits an overall comment from the handoff popover", async () => {
    const onCompleteReview = vi
      .fn<(options?: CompleteReviewOptions) => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const commentTrigger = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-comment-trigger",
    );
    if (!commentTrigger) {
      throw new Error("Review handoff comment trigger not found");
    }

    await click(commentTrigger);

    const textarea = queryByTestId<HTMLTextAreaElement>(
      document.body,
      "review-handoff-overall-comment",
    );
    if (!textarea) {
      throw new Error("Overall comment textarea not found");
    }
    expect(textarea.getAttribute("placeholder")).toBe("Overall comment");
    expect(document.body.textContent).not.toContain("Overall comment");

    await change(textarea, "  Please prioritize the CLI contract.  ");

    const submitButton = queryByTestId<HTMLButtonElement>(
      document.body,
      "review-handoff-submit-comment",
    );
    if (!submitButton) {
      throw new Error("Submit with comment button not found");
    }
    await click(submitButton);

    expect(onCompleteReview).toHaveBeenCalledWith({
      overallComment: "Please prioritize the CLI contract.",
    });
    expect(document.body.textContent).not.toContain(
      "Please prioritize the CLI contract.",
    );
  });

  it("includes an overall comment when finishing from the primary handoff button", async () => {
    const onCompleteReview = vi
      .fn<(options?: CompleteReviewOptions) => Promise<CompleteReviewResult>>()
      .mockResolvedValue({ delivered: true });

    await renderWorkspace({ getWatcherCount: () => 1, onCompleteReview });

    const commentTrigger = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-comment-trigger",
    );
    if (!commentTrigger) {
      throw new Error("Review handoff comment trigger not found");
    }

    await click(commentTrigger);

    const textarea = queryByTestId<HTMLTextAreaElement>(
      document.body,
      "review-handoff-overall-comment",
    );
    if (!textarea) {
      throw new Error("Overall comment textarea not found");
    }

    await change(textarea, "  Please prioritize the CLI contract.  ");

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledWith({
      overallComment: "Please prioritize the CLI contract.",
    });
  });

  it("keeps visible sent feedback after the watcher receives the event", async () => {
    let watcherCount = 1;
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockImplementation(async () => {
        watcherCount = 0;
        return { delivered: true };
      });

    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }

    await click(doneReviewingButton);
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    expect(onCompleteReview).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Sent");
    expect(container.textContent).not.toContain("Agent notified");
    expect(container.textContent).not.toContain("Approve");
    expect(container.textContent).not.toContain("I'm done");
  });

  it("lets a new watcher start another handoff after sent feedback", async () => {
    let watcherCount = 1;
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockImplementation(async () => {
        watcherCount = 0;
        return { delivered: true };
      });

    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    const doneReviewingButton = queryByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    if (!doneReviewingButton) {
      throw new Error("I'm done button not found");
    }

    await click(doneReviewingButton);
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    expect(container.textContent).toContain("Sent");
    expect(container.textContent).not.toContain("Approve");
    expect(container.textContent).not.toContain("I'm done");

    watcherCount = 1;
    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Approve");
    expect(container.textContent).not.toContain("Sent");
  });

  it("reopens the sent popover from the muted primary button", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0);
    const writeText = vi.fn<Clipboard["writeText"]>().mockResolvedValue();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const closeWindow = vi.spyOn(window, "close").mockImplementation(() => {});
    let watcherCount = 1;
    const onCompleteReview = vi
      .fn<() => Promise<CompleteReviewResult>>()
      .mockImplementation(async () => {
        watcherCount = 0;
        return { delivered: true };
      });

    await renderWorkspace({
      getWatcherCount: () => watcherCount,
      onCompleteReview,
    });

    const doneReviewingButton = getByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    await click(doneReviewingButton);

    expect(onCompleteReview).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("Sent");
    expect(document.body.textContent).toContain("Nice one!");
    expect(document.body.textContent).toContain(
      "Your agent is now working in the background on this, in all likelihood. If our signal didn't make it, just click here to copy a line you can send it to keep going.",
    );
    expect(queryByTestId(document.body, "review-handoff-status")).toBeDefined();
    expect(
      getByTestId(document.body, "review-handoff-status").querySelector(
        ".h-\\[170px\\]",
      ),
    ).not.toBeNull();
    expect(
      queryByTestId(document.body, "review-handoff-robots-toy"),
    ).toBeDefined();

    await act(async () => {
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      await Promise.resolve();
    });

    expect(queryByTestId(document.body, "review-handoff-status")).toBeNull();

    const sentButton = getByTestId<HTMLButtonElement>(
      container,
      "review-handoff-button",
    );
    expect(sentButton.disabled).toBe(false);

    await click(sentButton);

    expect(onCompleteReview).toHaveBeenCalledTimes(1);
    expect(queryByTestId(document.body, "review-handoff-status")).toBeDefined();

    const toy = getByTestId(document.body, "review-handoff-robots-toy");
    await click(toy);

    expect(document.body.textContent).toContain("Great work!");

    const copyLink = queryByTestId<HTMLButtonElement>(
      document.body,
      "review-handoff-copy-message",
    );
    expect(copyLink).toBeDefined();
    if (!copyLink) {
      throw new Error("Review handoff fallback copy link not found");
    }

    await click(copyLink);

    expect(writeText).toHaveBeenCalledWith(
      "I am done reviewing this file: test.md",
    );

    await click(getByTestId(document.body, "review-handoff-close-window"));

    expect(closeWindow).toHaveBeenCalled();
  });
});
