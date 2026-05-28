// Lazily loads Mermaid and renders a diagram into a DOM container. The dynamic
// import keeps Mermaid (a multi-MB dependency) out of the base bundle — Vite
// code-splits it into its own chunk fetched only when a diagram is present.

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
      // securityLevel "strict" disables raw HTML/script in diagrams — required
      // since diagram source can come from untrusted documents.
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

/**
 * Render `source` into `container` as an SVG diagram. While Mermaid loads, the
 * raw source is shown as a fallback; on any parse/render error the source is
 * shown with an error class instead of crashing the document.
 */
export async function renderMermaidInto(
  container: HTMLElement,
  source: string,
): Promise<void> {
  const trimmed = source.trim();

  if (!trimmed) {
    container.replaceChildren();
    return;
  }

  // Fallback shown until the async render resolves.
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
