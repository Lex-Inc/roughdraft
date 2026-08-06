export type MermaidColorScheme = "light" | "dark";

type MermaidApi = typeof import("mermaid")["default"];

let nextRenderId = 0;
let renderQueue: Promise<void> = Promise.resolve();

async function loadMermaid(): Promise<MermaidApi> {
  const module = await import("mermaid");
  return module.default;
}

export function renderMermaidDiagram(
  source: string,
  colorScheme: MermaidColorScheme,
): Promise<string> {
  const renderId = `roughdraft-mermaid-${++nextRenderId}`;
  const renderTask = renderQueue.then(async () => {
    const mermaid = await loadMermaid();
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: colorScheme === "dark" ? "dark" : "default",
    });
    const { svg } = await mermaid.render(renderId, source);
    return svg;
  });

  renderQueue = renderTask.then(
    () => undefined,
    () => undefined,
  );

  return renderTask;
}

export function resetMermaidRenderStateForTests() {
  nextRenderId = 0;
  renderQueue = Promise.resolve();
}
