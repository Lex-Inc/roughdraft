import { beforeEach, describe, expect, it, vi } from "vitest";

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(),
}));

vi.mock("mermaid", () => ({ default: mermaidMocks }));

import {
  renderMermaidDiagram,
  resetMermaidRenderStateForTests,
} from "../src/render-mermaid";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

describe("renderMermaidDiagram", () => {
  beforeEach(() => {
    mermaidMocks.initialize.mockReset();
    mermaidMocks.render.mockReset();
    resetMermaidRenderStateForTests();
  });

  it("uses strict Mermaid settings, the requested theme, and unique IDs", async () => {
    mermaidMocks.render.mockResolvedValue({ svg: "<svg />" });

    await renderMermaidDiagram("flowchart LR\nA --> B", "light");
    await renderMermaidDiagram("sequenceDiagram\nA->>B: Hello", "dark");

    expect(mermaidMocks.initialize).toHaveBeenNthCalledWith(1, {
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "default",
    });
    expect(mermaidMocks.initialize).toHaveBeenNthCalledWith(2, {
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "dark",
    });
    expect(mermaidMocks.render.mock.calls[0]?.[0]).toBe("roughdraft-mermaid-1");
    expect(mermaidMocks.render.mock.calls[1]?.[0]).toBe("roughdraft-mermaid-2");
  });

  it("serializes renders so Mermaid's global theme cannot race", async () => {
    const firstRender = deferred<{ svg: string }>();
    mermaidMocks.render
      .mockReturnValueOnce(firstRender.promise)
      .mockResolvedValueOnce({ svg: '<svg data-result="second" />' });

    const first = renderMermaidDiagram("flowchart LR\nA --> B", "light");
    const second = renderMermaidDiagram("flowchart LR\nA --> C", "dark");

    await vi.waitFor(() =>
      expect(mermaidMocks.render).toHaveBeenCalledTimes(1),
    );
    firstRender.resolve({ svg: '<svg data-result="first" />' });

    await expect(first).resolves.toContain('data-result="first"');
    await expect(second).resolves.toContain('data-result="second"');
    expect(mermaidMocks.render).toHaveBeenCalledTimes(2);
  });
});
