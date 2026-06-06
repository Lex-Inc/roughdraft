// Lazily load Mermaid so documents without diagrams do not pay the bundle cost.

type MermaidApi = typeof import("mermaid")["default"];

let mermaidPromise: Promise<MermaidApi> | null = null;
let renderSeq = 0;

function preferredTheme(): "dark" | "default" {
  return document.documentElement.classList.contains("dark")
    ? "dark"
    : "default";
}

async function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then((mod) => {
      const mermaid = mod.default;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: preferredTheme(),
      });
      return mermaid;
    });
  }

  return mermaidPromise;
}

function showSource(container: HTMLElement, source: string, className: string) {
  const pre = document.createElement("pre");
  pre.className = className;
  const code = document.createElement("code");
  code.className = "language-mermaid";
  code.textContent = source;
  pre.appendChild(code);
  container.replaceChildren(pre);
}

export async function renderMermaidInto(
  container: HTMLElement,
  source: string,
): Promise<void> {
  const trimmed = source.trim();

  if (!trimmed) {
    container.replaceChildren();
    return;
  }

  showSource(container, source, "mermaid-source-fallback");

  try {
    const mermaid = await loadMermaid();
    renderSeq += 1;
    const id = `mermaid-diagram-${renderSeq}`;
    const { svg } = await mermaid.render(id, trimmed);
    container.innerHTML = svg;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    showSource(container, `${message}\n\n${source}`, "mermaid-error");
  }
}
