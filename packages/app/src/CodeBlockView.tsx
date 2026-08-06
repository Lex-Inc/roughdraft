import { Code2, LoaderCircle, TriangleAlert, Workflow } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  NodeViewContent,
  NodeViewWrapper,
  type NodeViewProps,
} from "@tiptap/react";
import { Button } from "@/components/ui/button";
import {
  type MermaidColorScheme,
  renderMermaidDiagram,
} from "./render-mermaid";

type MermaidViewMode = "diagram" | "source";
type MermaidRenderState =
  | { status: "loading"; svg: string | null; error: null }
  | { status: "ready"; svg: string; error: null }
  | { status: "error"; svg: null; error: string };

const colorSchemeQuery = "(prefers-color-scheme: dark)";
const renderDelayMs = 180;
export const mermaidSourceSelectionEvent =
  "roughdraft:mermaid-source-selection";

function getSystemColorScheme(): MermaidColorScheme {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return "light";
  }

  return window.matchMedia(colorSchemeQuery).matches ? "dark" : "light";
}

function useSystemColorScheme() {
  const [colorScheme, setColorScheme] =
    useState<MermaidColorScheme>(getSystemColorScheme);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;

    const query = window.matchMedia(colorSchemeQuery);
    const updateColorScheme = (event: MediaQueryListEvent) => {
      setColorScheme(event.matches ? "dark" : "light");
    };

    setColorScheme(query.matches ? "dark" : "light");
    query.addEventListener("change", updateColorScheme);
    return () => query.removeEventListener("change", updateColorScheme);
  }, []);

  return colorScheme;
}

function getMermaidErrorMessage(error: unknown) {
  const detail = error instanceof Error ? error.message.split("\n")[0] : null;
  return detail
    ? `Check the Mermaid syntax below. ${detail}`
    : "Check the Mermaid syntax below and try again.";
}

function MermaidCodeBlock({ node }: NodeViewProps) {
  const source = node.textContent;
  const colorScheme = useSystemColorScheme();
  const [mode, setMode] = useState<MermaidViewMode>("diagram");
  const [renderState, setRenderState] = useState<MermaidRenderState>({
    status: "loading",
    svg: null,
    error: null,
  });
  const renderRequestRef = useRef(0);
  const wrapperRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const request = ++renderRequestRef.current;
    setRenderState((current) => ({
      status: "loading",
      svg: current.status === "ready" ? current.svg : null,
      error: null,
    }));

    const timeout = window.setTimeout(() => {
      void renderMermaidDiagram(source, colorScheme).then(
        (svg) => {
          if (request !== renderRequestRef.current) return;
          setRenderState({ status: "ready", svg, error: null });
        },
        (error: unknown) => {
          if (request !== renderRequestRef.current) return;
          setRenderState({
            status: "error",
            svg: null,
            error: getMermaidErrorMessage(error),
          });
          setMode("source");
        },
      );
    }, renderDelayMs);

    return () => {
      window.clearTimeout(timeout);
      renderRequestRef.current += 1;
    };
  }, [colorScheme, source]);

  useEffect(() => {
    const nodeViewElement = wrapperRef.current?.parentElement;
    if (!nodeViewElement) return;

    const revealSource = () => setMode("source");
    nodeViewElement.addEventListener(mermaidSourceSelectionEvent, revealSource);
    return () =>
      nodeViewElement.removeEventListener(
        mermaidSourceSelectionEvent,
        revealSource,
      );
  }, []);

  const showDiagram = mode === "diagram";

  return (
    <NodeViewWrapper
      ref={wrapperRef}
      className="mermaid-code-block"
      data-testid="mermaid-code-block"
    >
      <div
        className="mermaid-code-block-toolbar"
        contentEditable={false}
        role="group"
        aria-label="Mermaid view"
        onMouseDown={(event) => event.preventDefault()}
      >
        <Button
          type="button"
          variant={showDiagram ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={showDiagram}
          data-testid="mermaid-view-diagram"
          disabled={renderState.status === "error"}
          onClick={() => setMode("diagram")}
        >
          <Workflow aria-hidden="true" />
          Diagram
        </Button>
        <Button
          type="button"
          variant={!showDiagram ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={!showDiagram}
          data-testid="mermaid-view-source"
          onClick={() => setMode("source")}
        >
          <Code2 aria-hidden="true" />
          Source
        </Button>
      </div>

      <div
        className="mermaid-code-block-diagram"
        data-testid="mermaid-diagram-panel"
        hidden={!showDiagram}
        contentEditable={false}
      >
        {renderState.status === "loading" ? (
          <div className="mermaid-code-block-loading" role="status">
            <LoaderCircle className="mermaid-code-block-spinner" />
            Rendering diagram…
          </div>
        ) : null}
        {renderState.status === "ready" ? (
          <div
            className="mermaid-code-block-svg"
            data-testid="mermaid-rendered-svg"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid's strict security mode sanitizes the generated SVG before it reaches this presentation-only node.
            dangerouslySetInnerHTML={{ __html: renderState.svg }}
          />
        ) : null}
      </div>

      {renderState.status === "error" ? (
        <div
          className="mermaid-code-block-error"
          data-testid="mermaid-render-error"
          role="alert"
          contentEditable={false}
        >
          <TriangleAlert aria-hidden="true" />
          <span>
            <strong>Couldn’t render this diagram.</strong> {renderState.error}
          </span>
        </div>
      ) : null}

      <pre
        className="mermaid-code-block-source"
        data-testid="mermaid-source-panel"
        hidden={showDiagram}
      >
        <code>
          <NodeViewContent />
        </code>
      </pre>
    </NodeViewWrapper>
  );
}

export function CodeBlockView(props: NodeViewProps) {
  const language =
    typeof props.node.attrs.language === "string"
      ? props.node.attrs.language.trim().toLowerCase()
      : "";

  if (language === "mermaid") {
    return <MermaidCodeBlock {...props} />;
  }

  return (
    <NodeViewWrapper
      as="pre"
      data-testid="code-block"
      data-code-language={language || undefined}
    >
      <code>
        <NodeViewContent />
      </code>
    </NodeViewWrapper>
  );
}
