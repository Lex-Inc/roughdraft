import { EditorContent } from "@tiptap/react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criticMarkdownToEditorState } from "../src/critic-markup";
import { createEditorExtensions } from "../src/editor-extensions";
import { renderMermaidDiagram } from "../src/render-mermaid";
import { Editor } from "@tiptap/core";

vi.mock("../src/render-mermaid", () => ({
  renderMermaidDiagram: vi.fn(),
}));

vi.mock("tiptap-extension-code-block-shiki", async () => {
  const module = await vi.importActual<
    typeof import("@tiptap/extension-code-block")
  >("@tiptap/extension-code-block");
  return { CodeBlockShiki: module.default };
});

type MediaListener = (event: MediaQueryListEvent) => void;

const cleanups: Array<() => Promise<void>> = [];
let mediaListeners: Set<MediaListener>;
let prefersDark = false;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function renderEditor(markdown: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  const { doc } = criticMarkdownToEditorState(markdown);
  const editor = new Editor({
    extensions: createEditorExtensions(""),
    content: doc,
  });

  await act(async () => {
    root.render(<EditorContent editor={editor} />);
    await Promise.resolve();
  });

  const cleanup = async () => {
    await act(async () => root.unmount());
    editor.destroy();
    container.remove();
  };
  cleanups.push(cleanup);

  return { container, editor, cleanup };
}

async function finishRenderDelay() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(200);
    await Promise.resolve();
  });
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
  });
}

function getByTestId(container: ParentNode, testId: string) {
  const element = container.querySelector<HTMLElement>(
    `[data-testid="${testId}"]`,
  );
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

describe("code block node view", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(renderMermaidDiagram).mockReset();
    mediaListeners = new Set();
    prefersDark = false;
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: prefersDark,
        media: query,
        onchange: null,
        addEventListener: (_type: string, listener: MediaListener) =>
          mediaListeners.add(listener),
        removeEventListener: (_type: string, listener: MediaListener) =>
          mediaListeners.delete(listener),
        dispatchEvent: () => true,
      })),
    );
  });

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders Mermaid as a diagram first and toggles without changing the document", async () => {
    vi.mocked(renderMermaidDiagram).mockResolvedValue(
      '<svg data-result="diagram" />',
    );
    const rendered = await renderEditor(`\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`);
    const originalDocument = rendered.editor.getJSON();

    expect(
      getByTestId(rendered.container, "mermaid-diagram-panel").hidden,
    ).toBe(false);
    expect(getByTestId(rendered.container, "mermaid-source-panel").hidden).toBe(
      true,
    );

    await finishRenderDelay();
    expect(
      getByTestId(rendered.container, "mermaid-rendered-svg"),
    ).toHaveProperty("innerHTML", '<svg data-result="diagram"></svg>');

    await click(getByTestId(rendered.container, "mermaid-view-source"));
    expect(getByTestId(rendered.container, "mermaid-source-panel").hidden).toBe(
      false,
    );
    expect(
      getByTestId(rendered.container, "mermaid-diagram-panel").hidden,
    ).toBe(true);

    await click(getByTestId(rendered.container, "mermaid-view-diagram"));
    expect(rendered.editor.getJSON()).toEqual(originalDocument);
  });

  it("reveals hidden Mermaid source when the editor selection moves into it", async () => {
    vi.mocked(renderMermaidDiagram).mockResolvedValue("<svg />");
    const rendered = await renderEditor(`\`\`\`MERMAID
flowchart LR
  A --> B
\`\`\`
`);

    expect(getByTestId(rendered.container, "mermaid-source-panel").hidden).toBe(
      true,
    );

    await act(async () => {
      rendered.editor.commands.focus();
      rendered.editor.commands.setTextSelection({ from: 2, to: 5 });
      await Promise.resolve();
    });

    expect(getByTestId(rendered.container, "mermaid-source-panel").hidden).toBe(
      false,
    );
  });

  it("forces source open with an actionable error when Mermaid is invalid", async () => {
    vi.mocked(renderMermaidDiagram).mockRejectedValue(
      new Error("Parse error near line 2"),
    );
    const rendered = await renderEditor(`\`\`\`mermaid
flowchart ???
\`\`\`
`);

    await finishRenderDelay();

    expect(getByTestId(rendered.container, "mermaid-source-panel").hidden).toBe(
      false,
    );
    expect(
      getByTestId(rendered.container, "mermaid-render-error").textContent,
    ).toContain("Check the Mermaid syntax below");
    expect(
      rendered.container.querySelector('[data-testid="mermaid-rendered-svg"]'),
    ).toBeNull();
  });

  it("re-renders Mermaid when the system color scheme changes", async () => {
    vi.mocked(renderMermaidDiagram).mockImplementation(
      async (_source, theme) => `<svg data-theme="${theme}" />`,
    );
    const rendered = await renderEditor(`\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`);

    await finishRenderDelay();
    expect(renderMermaidDiagram).toHaveBeenLastCalledWith(
      "flowchart LR\n  A --> B",
      "light",
    );

    prefersDark = true;
    await act(async () => {
      for (const listener of mediaListeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
      await Promise.resolve();
    });
    await finishRenderDelay();

    expect(renderMermaidDiagram).toHaveBeenLastCalledWith(
      "flowchart LR\n  A --> B",
      "dark",
    );
    expect(
      getByTestId(rendered.container, "mermaid-rendered-svg").innerHTML,
    ).toContain('data-theme="dark"');
  });

  it("ignores stale async Mermaid results after the source changes", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    vi.mocked(renderMermaidDiagram)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const rendered = await renderEditor(`\`\`\`mermaid
flowchart LR
  A --> B
\`\`\`
`);

    await finishRenderDelay();

    const { doc: updatedDoc } = criticMarkdownToEditorState(`\`\`\`mermaid
flowchart LR
  A --> C
\`\`\`
`);
    await act(async () => {
      rendered.editor.commands.setContent(updatedDoc);
      await Promise.resolve();
    });
    await finishRenderDelay();

    await act(async () => {
      second.resolve('<svg data-result="latest" />');
      await second.promise;
    });
    await act(async () => {
      first.resolve('<svg data-result="stale" />');
      await first.promise;
    });

    expect(
      getByTestId(rendered.container, "mermaid-rendered-svg").innerHTML,
    ).toContain('data-result="latest"');
  });

  it("keeps unknown fenced languages readable as plain text", async () => {
    const rendered = await renderEditor(`\`\`\`roughdraft-unknown
alpha < beta
\`\`\`
`);

    expect(rendered.container.textContent).toContain("alpha < beta");
    expect(
      getByTestId(rendered.container, "code-block").getAttribute(
        "data-code-language",
      ),
    ).toBe("roughdraft-unknown");
    expect(rendered.editor.getJSON().content?.[0]?.attrs).toEqual({
      language: "roughdraft-unknown",
    });
  });
});
