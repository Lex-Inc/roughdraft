import {
  ArrowLeft,
  Braces,
  Check,
  CodeXml,
  Copy,
  ExternalLink,
  Eye,
  FileText,
  MessageSquare,
  PencilLine,
  Terminal,
} from "lucide-react";
import {
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  buildLocationForDocumentEditorViewMode,
  type DocumentEditorViewMode,
  formatWorkspacePathForDisplay,
  getDocumentEditorViewModeFromLocation,
  getPathLeaf,
  getRequestedPathState,
  joinPath,
  PREVIEW_PATH,
  ROUGHDRAFT_FLAVORED_MARKDOWN_PATH,
  syncRequestedPathInUrl,
} from "./app-navigation";
import { Button } from "./components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./components/ui/dialog";
import { DocumentWorkspace } from "./DocumentWorkspace";
import { detectBackend } from "./detect-backend";
import {
  getCommentAnchorMeasurements,
  groupCommentAnchorMeasurements,
  normalizeCommentMeasurement,
  resolveAnchoredRailLayouts,
} from "./document-comments";
import { cn } from "./lib/utils";
import type { DocumentSaveState } from "./PageCard";
import { PreviewBackend } from "./preview-backend";
import { RoughdraftFormatDemo } from "./RoughdraftFormatDemo";
import {
  type CompleteReviewOptions,
  MarkdownFileConflictError,
  type Page,
  type StorageBackend,
} from "./storage";
import { UpdateNotice } from "./UpdateNotice";
import { fetchUpdateStatus, type UpdateStatus } from "./update-status";

export type DocumentDiskChangeState =
  | "clean"
  | "changed"
  | "conflict"
  | "paused";

export function shouldWarnBeforeUnload({
  activeDocumentPath,
  isDirty,
  saveState,
  diskChangeState,
}: {
  activeDocumentPath: string | null;
  isDirty: boolean;
  saveState: DocumentSaveState;
  diskChangeState: DocumentDiskChangeState;
}) {
  return (
    !!activeDocumentPath &&
    (isDirty ||
      saveState === "saving" ||
      saveState === "unsaved" ||
      saveState === "error" ||
      diskChangeState !== "clean")
  );
}

const AGENT_SETUP_PROMPT =
  "Install Roughdraft for me using `npm i -g roughdraft`, then read https://roughdraft.md/setup.md and set yourself up to use it.";
const PREVIEW_DOCUMENT_PATH = "preview.md";
const PREVIEW_INITIAL_MARKDOWN = [
  "# Live Preview",
  "",
  "This draft only lives in memory. Edit it freely, switch between rich text and code view, and reload the page when you want a clean copy.",
  "",
  "- Comments and suggested changes use Roughdraft flavored Markdown.",
  "- Autosave updates the in-memory document, not disk or browser storage.",
  "",
  "{==Select this sentence==}{>>Try replying to this comment or suggesting a replacement.<<}{#preview-comment}",
  "",
  "---",
  "comments:",
  "  preview-comment:",
  "    by: Roughdraft",
  '    at: "2026-04-28T12:00:00.000Z"',
  "",
].join("\n");
const HOMEPAGE_WORKFLOW_SCENES = [
  {
    step: "1",
    title: "Ask for a plan",
    description:
      "Start in the same agent chat you already use. Ask for a reviewable Markdown plan before implementation begins.",
  },
  {
    step: "2",
    title: "The agent works normally",
    description:
      "It inspects files, runs tools, and drafts the plan in the background. Roughdraft does not replace your agent workflow.",
  },
  {
    step: "3",
    title: "Roughdraft opens the plan",
    description:
      "When the file is ready, the agent opens the Markdown plan in Roughdraft and waits while you review.",
  },
  {
    step: "4",
    title: "Leave comments and suggestions",
    description:
      "Ask questions, redirect priorities, and suggest exact wording inline where the agent can read it later.",
  },
  {
    step: "5",
    title: "Click I'm done",
    description:
      "Roughdraft hands control back to the agent once you are finished with the blocking review step.",
  },
  {
    step: "6",
    title: "The agent resumes",
    description:
      "The next agent turn reads the same Markdown file, sees your comments and suggestions, and continues with the corrected plan.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_SYNTAX = [
  {
    label: "Comment",
    syntax: "{==selected text==}{>>Comment text<<}{#c1}",
    description:
      "Highlights the reviewed text and attaches a margin comment to it.",
  },
  {
    label: "Reply",
    syntax:
      'comments:\n  c2:\n    body: I can make that edit.\n    by: AI\n    at: "2026-04-28T12:01:00.000Z"\n    re: c1',
    description:
      "Adds a threaded reply in YAML endmatter by pointing `re` at the parent id.",
  },
  {
    label: "Insertion",
    syntax: "{++new text++}{#s1}",
    description: "Suggests text to add without applying it silently.",
  },
  {
    label: "Deletion",
    syntax: "{--old text--}{#s2}",
    description: "Suggests removing text while keeping the original visible.",
  },
  {
    label: "Substitution",
    syntax: "{~~old text~>new text~~}{#s3}",
    description: "Suggests replacing one span with another.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_REFERENCES = [
  {
    title: "Official RFM spec",
    href: "/spec/roughdraft-flavored-markdown.md",
    description:
      "The normative syntax, metadata, round-trip, and JSON review-index contract for Roughdraft Flavored Markdown.",
  },
  {
    title: "CriticMarkup",
    href: "https://criticmarkup.com/",
    description:
      "The plain-text review syntax Roughdraft builds on for comments, highlights, insertions, deletions, and substitutions.",
  },
  {
    title: "Notion-flavored Markdown",
    href: "https://developers.notion.com/guides/data-apis/enhanced-markdown",
    description:
      "The product precedent for rich document affordances that still serialize to inspectable Markdown-like text.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_CONTRACT = [
  {
    title: "Metadata",
    description:
      "Compact inline references keep review anchors portable, while YAML endmatter stores authors, timestamps, statuses, and reply links.",
  },
  {
    title: "Anchors",
    description:
      "Comments attach to highlighted text when a highlight precedes the comment. A bare comment is allowed when the feedback applies to the surrounding paragraph or document.",
  },
  {
    title: "Pending changes",
    description:
      "Insertions, deletions, and substitutions stay visible until accepted or rejected. Roughdraft should not silently collapse suggested edits into normal prose.",
  },
  {
    title: "Round trips",
    description:
      "Normal Markdown should remain normal Markdown. Frontmatter, tables, task lists, links, image paths, code spans, and fenced code blocks should survive review edits with minimal serialization churn.",
  },
] as const;
const ROUGHDRAFT_MARKDOWN_EXTENSION_DETAILS = [
  {
    title: "YAML metadata",
    body: "Roughdraft stores ids inline as compact references such as {>>Looks right.<<}{#c1}, while authors, timestamps, and reply links live in final YAML endmatter.",
  },
  {
    title: "Threaded comments",
    body: "A comment can stand alone, attach to a highlighted span, or reply to another comment by setting `re` to the parent comment id.",
  },
  {
    title: "Reviewable suggestions",
    body: "Insertions, deletions, and substitutions can carry their own ids, then comments can reply to those ids to discuss a proposed edit before accepting it.",
  },
  {
    title: "Literal examples stay literal",
    body: "CriticMarkup inside inline code and fenced code blocks is preserved as example text instead of becoming live review feedback.",
  },
] as const;
const HOMEPAGE_WORKFLOW_REVIEW_ITEMS = [
  {
    key: "nora-comment",
    commentIds: ["nora-comment"],
    author: "Nora",
    body: 'This should go above "It\'s just Markdown."',
    kind: "comment",
    replies: [
      {
        author: "AI",
        body: "Sounds good. I'll move it above that section.",
      },
    ],
  },
  {
    key: "nora-suggestion",
    commentIds: ["nora-suggestion"],
    author: "Nora",
    body: 'Replace: "agent\'s plan" with "homepage plan"',
    kind: "suggestion",
    replies: [],
  },
] as const;

export function HomepageSubtitle() {
  return (
    <>
      Refine complex ideas with{" "}
      <span
        className="rounded-sm bg-[#fff5c7] px-1 text-slate-950 dark:bg-amber-500/35 dark:text-slate-50"
        data-testid="homepage-subtitle-comment"
      >
        comments
      </span>{" "}
      <span
        className="rounded-sm bg-emerald-50 px-1 text-emerald-950 underline decoration-emerald-500/75 underline-offset-[0.16em] dark:bg-emerald-950/50 dark:text-emerald-200"
        data-testid="homepage-subtitle-addition"
      >
        and suggestions
      </span>
      .
      <br data-testid="homepage-subtitle-break" />
      Free, open source, local.
    </>
  );
}

function getHomepageWorkflowDocumentScale(element: HTMLElement | null) {
  const scaleElement = element?.closest<HTMLElement>(
    "[data-homepage-workflow-document-scale]",
  );
  const scaleTransform = scaleElement
    ? window.getComputedStyle(scaleElement).transform
    : "none";
  const matrix =
    scaleTransform === "none" ? null : new DOMMatrixReadOnly(scaleTransform);

  return matrix?.a || 1;
}

export function Homepage({
  message,
  updateStatus,
}: {
  message: ReactNode;
  updateStatus: UpdateStatus | null;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "error">(
    "idle",
  );
  const workflowStepRefs = useRef<Record<string, HTMLLIElement | null>>({});
  const workflowIntroRef = useRef<HTMLDivElement | null>(null);
  const workflowStickyVisualRef = useRef<HTMLDivElement | null>(null);
  const workflowTerminalRef = useRef<HTMLDivElement | null>(null);
  const [homepageWorkflowStage, setHomepageWorkflowStage] = useState(1);
  const [mobileWorkflowVisualVisible, setMobileWorkflowVisualVisible] =
    useState(false);

  const handleCopySetupPrompt = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(AGENT_SETUP_PROMPT);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  }, []);

  useEffect(() => {
    const updateHomepageWorkflowStage = () => {
      const isMobileStoryboard =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(max-width: 899px)").matches;
      const workflowIntroRect =
        workflowIntroRef.current?.getBoundingClientRect();
      const nextMobileWorkflowVisualVisible =
        !isMobileStoryboard ||
        (workflowIntroRect ? workflowIntroRect.bottom <= 0 : false);

      setMobileWorkflowVisualVisible((current) =>
        current === nextMobileWorkflowVisualVisible
          ? current
          : nextMobileWorkflowVisualVisible,
      );

      const pageCanScroll =
        document.documentElement.scrollHeight > window.innerHeight + 1;
      if (!pageCanScroll) return;

      const stickyVisualRect =
        workflowStickyVisualRef.current?.getBoundingClientRect();
      const terminalRect = workflowTerminalRef.current?.getBoundingClientRect();
      const mobileReadableOffset = stickyVisualRect
        ? Math.min(stickyVisualRect.height + 32, window.innerHeight * 0.35)
        : 0;
      const activationLine =
        isMobileStoryboard && stickyVisualRect
          ? Math.max(0, Math.ceil(stickyVisualRect.top - mobileReadableOffset))
          : (terminalRect?.top ?? 0);

      let nextStage = 1;
      for (const [step, element] of Object.entries(workflowStepRefs.current)) {
        if (!element) continue;

        const stepNumber = Number(step);
        if (
          element.getBoundingClientRect().top <= activationLine &&
          stepNumber > nextStage
        ) {
          nextStage = stepNumber;
        }
      }

      setHomepageWorkflowStage((current) =>
        current === nextStage ? current : nextStage,
      );
    };

    updateHomepageWorkflowStage();
    window.addEventListener("scroll", updateHomepageWorkflowStage, {
      passive: true,
    });
    window.addEventListener("resize", updateHomepageWorkflowStage);

    return () => {
      window.removeEventListener("scroll", updateHomepageWorkflowStage);
      window.removeEventListener("resize", updateHomepageWorkflowStage);
    };
  }, []);

  return (
    <div
      className="flex min-h-screen items-start justify-center bg-[#FCFCFC] dark:bg-background px-6 pt-8 pb-12 text-slate-950 dark:text-slate-50"
      data-testid="homepage"
    >
      {updateStatus ? (
        <div className="absolute top-4 right-4 max-w-sm">
          <UpdateNotice updateStatus={updateStatus} />
        </div>
      ) : null}
      <div className="w-full">
        <div className="font-die-grotesk-a mx-auto max-w-[100rem] text-left">
          <p
            className="text-[clamp(1.125rem,0.9rem+0.35vw,1.375rem)] font-bold text-stone-500 dark:text-stone-500"
            data-testid="homepage-logo"
          >
            roughdraft.md
          </p>
          <div className="mt-20 sm:mt-28">
            <h1
              className="font-die-grotesk-b text-[clamp(2.875rem,14.2vw,5rem)] leading-[0.88] font-bold text-slate-950 dark:text-slate-50"
              data-testid="homepage-heading"
            >
              Easier collaboration
              <br data-testid="homepage-heading-break" />
              with your agent
            </h1>
            <p className="mt-5 max-w-5xl text-[clamp(1.25rem,0.9rem+1vw,1.75rem)] leading-none text-slate-950 dark:text-slate-50">
              {message}
            </p>

            <div className="mt-7 flex flex-col items-start justify-start gap-3">
              <Dialog>
                <DialogTrigger
                  render={
                    <Button
                      className="h-14 cursor-pointer gap-2 px-5 text-[clamp(1.25rem,1rem+0.6vw,1.5rem)]"
                      data-testid="homepage-install-button"
                      size="lg"
                    >
                      Install now
                    </Button>
                  }
                />
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Give this to your coding agent</DialogTitle>
                    <DialogDescription>
                      This prompt tells the agent how to install Roughdraft and
                      set up the review workflow.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-4">
                    <p className="break-words text-sm leading-6 text-stone-800 dark:text-stone-200">
                      {AGENT_SETUP_PROMPT}
                    </p>
                    {copyState === "error" ? (
                      <p className="mt-3 text-sm text-red-600">
                        Copy failed. Select the instruction text and copy it
                        manually.
                      </p>
                    ) : null}
                  </div>

                  <DialogFooter>
                    <Button
                      className="h-9 gap-2 px-3 text-sm"
                      data-testid="homepage-copy-prompt-button"
                      type="button"
                      onClick={handleCopySetupPrompt}
                    >
                      {copyState === "copied" ? (
                        <Check className="size-4" aria-hidden="true" />
                      ) : (
                        <Copy className="size-4" aria-hidden="true" />
                      )}
                      {copyState === "copied" ? "Copied" : "Copy prompt"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              <div className="flex flex-wrap items-center justify-start gap-x-4 gap-y-1.5 text-xs text-stone-500">
                <Button
                  className="h-6 gap-1.5 px-1 text-xs text-stone-500 hover:bg-transparent hover:text-stone-700"
                  nativeButton={false}
                  size="sm"
                  variant="ghost"
                  render={
                    <a
                      href="https://github.com/Lex-Inc/roughdraft"
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                      View on GitHub
                    </a>
                  }
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-10 w-screen max-w-none -translate-x-6 overflow-hidden border-y border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-[0_20px_60px_rgba(15,23,42,0.12)] dark:shadow-[0_20px_60px_rgba(0,0,0,0.4)] min-[1000px]:mx-auto min-[1000px]:w-full min-[1000px]:max-w-[100rem] min-[1000px]:translate-x-0 min-[1000px]:rounded-lg min-[1000px]:border">
          <img
            data-testid="homepage-sneak-peek-image"
            src="/sneak-peek.png"
            alt="Roughdraft markdown review workspace"
            className="block aspect-[1728/1117] w-full object-cover"
          />
        </div>

        <section
          aria-labelledby="homepage-workflow-heading"
          className="mx-auto mt-12 w-full max-w-6xl overflow-visible text-left dark:text-slate-50"
          data-homepage-workflow-storyboard=""
          data-testid="homepage-workflow-storyboard"
        >
          <div
            className="homepage-workflow-intro font-die-grotesk-a py-8 pb-6 font-bold min-[900px]:pt-12 min-[900px]:pb-8"
            ref={workflowIntroRef}
          >
            <h2
              className="font-die-grotesk-b text-center text-[clamp(4rem,2.8rem+3vw,4.5rem)] font-bold text-slate-950 dark:text-slate-50"
              id="homepage-workflow-heading"
              data-testid="homepage-workflow-heading"
            >
              How it works
            </h2>
          </div>

          <div className="grid grid-cols-1 gap-6 [--homepage-workflow-dock-bottom:calc(0.75rem+env(safe-area-inset-bottom,0px))] [--homepage-workflow-dock-gap:clamp(1rem,4vw,1.5rem)] [--homepage-workflow-dock-height:clamp(16rem,38svh,20rem)] max-[899px]:gap-0 min-[900px]:grid-cols-[minmax(16rem,0.72fr)_minmax(0,1.28fr)] min-[900px]:items-start min-[900px]:gap-[clamp(2rem,5vw,4rem)] min-[900px]:[--homepage-workflow-dock-bottom:0rem] min-[900px]:[--homepage-workflow-dock-gap:0rem] min-[900px]:[--homepage-workflow-dock-height:auto]">
            <div
              className="homepage-workflow-sticky-visual min-w-0 max-[899px]:sticky max-[899px]:z-[2] max-[899px]:flex max-[899px]:h-[var(--homepage-workflow-dock-height)] max-[899px]:min-h-0 max-[899px]:items-end max-[899px]:overflow-visible max-[899px]:rounded-[0.65rem] max-[899px]:shadow-[0_18px_48px_rgba(15,23,42,0.16)] max-[899px]:transition-opacity max-[899px]:duration-200 max-[899px]:[bottom:var(--homepage-workflow-dock-bottom)] max-[899px]:[top:calc(100svh-var(--homepage-workflow-dock-height)-var(--homepage-workflow-dock-bottom))] max-[899px]:data-[mobile-workflow-visible=false]:pointer-events-none max-[899px]:data-[mobile-workflow-visible=false]:opacity-0 min-[900px]:sticky min-[900px]:top-8 min-[900px]:order-2 min-[900px]:flex min-[900px]:min-h-[calc(100vh-4rem)] min-[900px]:items-center min-[900px]:overflow-visible"
              data-homepage-workflow-sticky-visual=""
              data-mobile-workflow-visible={
                mobileWorkflowVisualVisible ? "true" : "false"
              }
              data-testid="homepage-workflow-sticky-visual"
              ref={workflowStickyVisualRef}
            >
              <HomepageWorkflowComposite
                workflowStage={homepageWorkflowStage}
                terminalRef={workflowTerminalRef}
              />
            </div>

            <ol
              className="grid list-none grid-cols-1 gap-0 p-0 max-[899px]:pb-[calc(var(--homepage-workflow-dock-height)+var(--homepage-workflow-dock-bottom)+2rem)] min-[900px]:order-1"
              data-testid="homepage-workflow-scene-list"
            >
              {HOMEPAGE_WORKFLOW_SCENES.map((scene) => (
                <HomepageWorkflowScene
                  description={scene.description}
                  key={scene.step}
                  sceneRef={(element) => {
                    workflowStepRefs.current[scene.step] = element;
                  }}
                  step={scene.step}
                  title={scene.title}
                />
              ))}
            </ol>
          </div>
        </section>

        <RoughdraftFormatDemo />
      </div>
    </div>
  );
}

function HomepageWorkflowScene({
  description,
  sceneRef,
  step,
  title,
}: {
  description: string;
  sceneRef?: (element: HTMLLIElement | null) => void;
  step: string;
  title: string;
}) {
  return (
    <li
      className="homepage-workflow-scene relative min-h-72 min-w-0 border-t border-slate-200 py-[clamp(1.75rem,7vw,4.5rem)] first:border-t-0 dark:border-slate-700 max-[899px]:min-h-[calc(100svh-3rem)] max-[899px]:pt-[clamp(2rem,8vw,3rem)] max-[899px]:pb-[calc(var(--homepage-workflow-dock-height)+var(--homepage-workflow-dock-bottom)+var(--homepage-workflow-dock-gap))] min-[900px]:flex min-[900px]:min-h-[min(42rem,calc(100vh-4rem))] min-[900px]:items-center"
      data-homepage-workflow-scene=""
      data-testid="homepage-workflow-scene"
      ref={sceneRef}
    >
      <div className="font-die-grotesk-a min-w-0 max-w-[28rem] font-bold max-[899px]:max-w-[min(100%,27rem)]">
        <div className="inline-flex h-12 min-w-12 items-center justify-center rounded-full border border-slate-950 bg-slate-950 px-2 text-[2.25rem] leading-none font-bold text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-950">
          {step}
        </div>
        <h3 className="font-die-grotesk-b mt-5 text-[clamp(2rem,1.5rem+1.5vw,2.5rem)] leading-tight font-bold text-balance text-slate-950 dark:text-slate-50">
          {title}
        </h3>
        <p className="mt-4 max-w-md text-base leading-7 text-stone-600 dark:text-stone-400">
          {description}
        </p>
      </div>
    </li>
  );
}

function HomepageWorkflowComposite({
  terminalRef,
  workflowStage,
}: {
  terminalRef?: Ref<HTMLDivElement>;
  workflowStage: number;
}) {
  return (
    <div className="relative min-h-[38rem] w-[min(100%,43rem)] max-[899px]:h-full max-[899px]:min-h-0 max-[899px]:w-full max-[520px]:min-h-0 min-[900px]:h-auto min-[900px]:min-h-[38rem]">
      <AgentChatMock terminalRef={terminalRef} workflowStage={workflowStage} />
      <RoughdraftPopupMock workflowStage={workflowStage} />
    </div>
  );
}

function AgentChatMock({
  terminalRef,
  workflowStage,
}: {
  terminalRef?: Ref<HTMLDivElement>;
  workflowStage: number;
}) {
  const showAgentWork = workflowStage >= 2;
  const showRoughdraftCommand = workflowStage >= 3;
  const showAgentResume = workflowStage >= 6;

  return (
    <div
      className="homepage-workflow-terminal w-full overflow-hidden rounded-lg border border-slate-950/70 bg-[#1F232B] font-mono text-slate-50 shadow-[0_20px_48px_rgba(15,23,42,0.16)] max-[899px]:h-full max-[899px]:border-slate-950/60 dark:shadow-[0_18px_44px_rgba(0,0,0,0.35)]"
      data-homepage-workflow-terminal-stage={workflowStage}
      data-testid="homepage-workflow-terminal"
      ref={terminalRef}
    >
      <div className="flex min-h-10 items-center justify-between gap-4 border-b border-slate-400/20 px-3.5 text-xs font-bold text-slate-300 max-[899px]:min-h-8 max-[899px]:px-3 max-[899px]:text-[0.68rem]">
        <div className="flex items-center gap-1.5" aria-hidden="true">
          <span className="inline-flex size-[0.65rem] rounded-full bg-rose-500" />
          <span className="inline-flex size-[0.65rem] rounded-full bg-amber-400" />
          <span className="inline-flex size-[0.65rem] rounded-full bg-emerald-500" />
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <Terminal className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">local-agent / roughdraft</span>
        </div>
      </div>

      <div className="grid gap-4 py-4 pb-[7.5rem] text-sm leading-[1.55] max-[899px]:gap-2.5 max-[899px]:py-3 max-[899px]:pb-[5.75rem] max-[899px]:text-[0.72rem] max-[899px]:leading-[1.45]">
        <div className="grid gap-0.5 px-4 text-slate-400 max-[899px]:px-3">
          <div className="font-semibold text-slate-100">Coding agent</div>
          <div>workspace ~/roughdraft</div>
        </div>

        <div className="flex gap-3 bg-zinc-700/75 px-4 py-[0.45rem] text-slate-50 max-[899px]:gap-2 max-[899px]:px-3 max-[899px]:py-1.5">
          <span className="text-slate-400">›</span>
          <span>
            Let's make the homepage more persuasive. Write a plan first.
          </span>
        </div>

        <div
          aria-hidden={showAgentWork ? undefined : true}
          className="grid max-h-80 gap-4 overflow-hidden opacity-100 transition-[max-height,opacity,transform] duration-300 data-[agent-work-visible=false]:max-h-0 data-[agent-work-visible=false]:translate-y-[-0.35rem] data-[agent-work-visible=false]:pointer-events-none data-[agent-work-visible=false]:opacity-0"
          data-agent-work-visible={showAgentWork ? "true" : "false"}
          data-testid="homepage-workflow-agent-work"
        >
          <div className="flex gap-3 px-4 text-slate-50 max-[899px]:px-3">
            <span className="mt-1 size-2 shrink-0 rounded-full bg-slate-100" />
            <span>
              I'll inspect the current homepage, draft a Markdown plan, and open
              it in Roughdraft for review before I code.
            </span>
          </div>

          <div
            className="mx-4 grid gap-1 text-xs leading-[1.55] text-slate-300 max-[899px]:mx-3 max-[899px]:text-[0.66rem]"
            data-testid="homepage-workflow-terminal-tools"
          >
            <div className="flex gap-3 font-bold text-slate-50">
              <span aria-hidden="true">•</span>
              <span>Explored</span>
            </div>
            <div className="grid gap-0.5 pr-1 pl-[1.55rem] max-[899px]:pl-[1.35rem]">
              <div className="grid grid-cols-[0.8rem_minmax(0,1fr)] gap-x-1.5 text-slate-50 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400" aria-hidden="true">
                  └
                </span>
                <span>
                  <span className="text-teal-300">Search</span> rg "It's just
                  Markdown" packages/app/src
                </span>
              </div>
              <div className="grid grid-cols-[0.8rem_minmax(0,1fr)] gap-x-1.5 text-slate-50 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400" aria-hidden="true" />
                <span>
                  <span className="text-teal-300">Read</span> sed -n '1,220p'
                  packages/app/src/App.tsx
                </span>
              </div>
              <div className="grid grid-cols-[0.8rem_minmax(0,1fr)] gap-x-1.5 text-slate-50 [overflow-wrap:anywhere]">
                <span className="font-bold text-slate-400" aria-hidden="true" />
                <span>
                  <span className="text-teal-300">Write</span>{" "}
                  .context/homepage-conversion-plan.md
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          aria-hidden={showRoughdraftCommand ? undefined : true}
          className="mx-4 max-h-32 overflow-hidden rounded-lg border border-slate-400/20 bg-slate-950/30 p-3 text-xs leading-[1.55] text-slate-50 opacity-100 transition-[max-height,margin,padding,border-width,opacity,transform] duration-300 data-[terminal-line-visible=false]:mt-[-1rem] data-[terminal-line-visible=false]:max-h-0 data-[terminal-line-visible=false]:translate-y-[-0.35rem] data-[terminal-line-visible=false]:border-0 data-[terminal-line-visible=false]:py-0 data-[terminal-line-visible=false]:pointer-events-none data-[terminal-line-visible=false]:opacity-0 max-[899px]:mx-3 max-[899px]:p-2 max-[899px]:text-[0.66rem]"
          data-terminal-line-visible={showRoughdraftCommand ? "true" : "false"}
          data-testid="homepage-workflow-terminal-command"
        >
          roughdraft open "/workspace/.context/homepage-conversion-plan.md"
          <div className="mt-2 text-slate-400">Waiting for I'm done...</div>
        </div>

        <div
          aria-hidden={showAgentResume ? undefined : true}
          className="flex max-h-32 gap-3 overflow-hidden px-4 text-slate-50 opacity-100 transition-[max-height,margin,padding,border-width,opacity,transform] duration-300 data-[terminal-line-visible=false]:mt-[-1rem] data-[terminal-line-visible=false]:max-h-0 data-[terminal-line-visible=false]:translate-y-[-0.35rem] data-[terminal-line-visible=false]:border-0 data-[terminal-line-visible=false]:py-0 data-[terminal-line-visible=false]:pointer-events-none data-[terminal-line-visible=false]:opacity-0 max-[899px]:px-3"
          data-terminal-line-visible={showAgentResume ? "true" : "false"}
          data-testid="homepage-workflow-agent-resume"
        >
          <span className="mt-1 size-2 shrink-0 rounded-full bg-emerald-300" />
          <span>
            I read your comments. I accepted your wording suggestion and moved
            the workflow story above the Markdown section.
          </span>
        </div>

        <div
          aria-hidden={showAgentWork ? undefined : true}
          className="flex min-h-[2.65rem] max-h-32 items-center gap-3 overflow-hidden border-y border-slate-300/60 px-4 text-slate-50 opacity-100 transition-[max-height,margin,padding,border-width,opacity,transform] duration-300 data-[terminal-line-visible=false]:mt-[-1rem] data-[terminal-line-visible=false]:max-h-0 data-[terminal-line-visible=false]:translate-y-[-0.35rem] data-[terminal-line-visible=false]:border-0 data-[terminal-line-visible=false]:py-0 data-[terminal-line-visible=false]:pointer-events-none data-[terminal-line-visible=false]:opacity-0"
          data-terminal-line-visible={showAgentWork ? "true" : "false"}
          data-testid="homepage-workflow-terminal-input"
        >
          <span className="text-slate-100">›</span>
          <span
            className="inline-flex h-5 w-2.5 bg-slate-50"
            aria-hidden="true"
          />
        </div>
      </div>
    </div>
  );
}

function RoughdraftPopupMock({ workflowStage }: { workflowStage: number }) {
  const visible = workflowStage >= 3;
  const showUserFeedback = workflowStage >= 4;
  const showAgentReply = workflowStage >= 6;
  const showIncorporatedPlan = workflowStage >= 6;
  const showDoneButton = workflowStage >= 5 && workflowStage < 6;
  const documentShellRef = useRef<HTMLDivElement | null>(null);
  const documentPageRef = useRef<HTMLDivElement | null>(null);
  const reviewRailRef = useRef<HTMLDivElement | null>(null);
  const threadRefs = useRef(new Map<string, HTMLDivElement>());
  const [commentAnchorGroups, setCommentAnchorGroups] = useState<
    Array<{
      key: string;
      commentIds: string[];
      anchorTop: number;
      anchorBottom: number;
    }>
  >([]);
  const [threadHeights, setThreadHeights] = useState<Record<string, number>>(
    {},
  );

  const measureHomepageReviewLayout = useCallback(() => {
    const shellElement = documentShellRef.current;
    const pageElement = documentPageRef.current;
    const railElement = reviewRailRef.current;

    if (!showUserFeedback || !shellElement || !pageElement || !railElement) {
      setCommentAnchorGroups([]);
      return;
    }

    const railRect = railElement.getBoundingClientRect();
    const measurementScale = getHomepageWorkflowDocumentScale(shellElement);
    const anchorElements =
      pageElement.querySelectorAll<HTMLElement>("[data-comment-ids]");

    setCommentAnchorGroups(
      groupCommentAnchorMeasurements(
        getCommentAnchorMeasurements(
          anchorElements,
          railRect.top,
          measurementScale,
        ),
      ),
    );
  }, [showUserFeedback]);

  useLayoutEffect(() => {
    measureHomepageReviewLayout();

    if (!showUserFeedback) return;

    const shellElement = documentShellRef.current;
    const pageElement = documentPageRef.current;
    const railElement = reviewRailRef.current;
    if (!shellElement || !pageElement || !railElement) return;

    const resizeObserver = new ResizeObserver(() => {
      measureHomepageReviewLayout();
    });

    resizeObserver.observe(shellElement);
    resizeObserver.observe(pageElement);
    resizeObserver.observe(railElement);
    window.addEventListener("resize", measureHomepageReviewLayout);

    if (document.fonts) {
      void document.fonts.ready.then(measureHomepageReviewLayout);
    }

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", measureHomepageReviewLayout);
    };
  }, [measureHomepageReviewLayout, showUserFeedback]);

  const setThreadRef = useCallback(
    (key: string, node: HTMLDivElement | null) => {
      if (node) {
        threadRefs.current.set(key, node);
      } else {
        threadRefs.current.delete(key);
      }
    },
    [],
  );

  useLayoutEffect(() => {
    if (!showUserFeedback) {
      setThreadHeights({});
      return;
    }

    const updateThreadHeights = () => {
      const measurementScale = getHomepageWorkflowDocumentScale(
        documentShellRef.current,
      );

      setThreadHeights((current) => {
        const next: Record<string, number> = {};
        let changed = false;

        for (const item of HOMEPAGE_WORKFLOW_REVIEW_ITEMS) {
          const element = threadRefs.current.get(item.key);
          const measuredHeight = Math.ceil(
            element?.getBoundingClientRect().height ?? 0,
          );
          const height =
            measuredHeight > 0
              ? Math.ceil(
                  normalizeCommentMeasurement(measuredHeight, measurementScale),
                )
              : (current[item.key] ?? 0);
          next[item.key] = height;
          changed ||= current[item.key] !== height;
        }

        if (
          !changed &&
          Object.keys(current).length === Object.keys(next).length
        ) {
          return current;
        }

        return next;
      });
    };

    updateThreadHeights();

    const resizeObserver = new ResizeObserver(() => {
      updateThreadHeights();
    });

    for (const item of HOMEPAGE_WORKFLOW_REVIEW_ITEMS) {
      const element = threadRefs.current.get(item.key);
      if (element) resizeObserver.observe(element);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [showUserFeedback]);

  const reviewLayouts = useMemo(() => {
    const railItems = HOMEPAGE_WORKFLOW_REVIEW_ITEMS.map((item) => {
      const anchorGroup = commentAnchorGroups.find((group) =>
        item.commentIds.every((commentId) =>
          group.commentIds.includes(commentId),
        ),
      );

      if (!anchorGroup) return null;

      return {
        ...item,
        anchorTop: anchorGroup.anchorTop,
        anchorBottom: anchorGroup.anchorBottom,
      };
    }).filter(
      (
        item,
      ): item is (typeof HOMEPAGE_WORKFLOW_REVIEW_ITEMS)[number] & {
        anchorTop: number;
        anchorBottom: number;
      } => Boolean(item),
    );

    return resolveAnchoredRailLayouts(railItems, threadHeights, null, 14, 72);
  }, [commentAnchorGroups, threadHeights]);

  return (
    <div
      aria-hidden={visible ? undefined : true}
      className="absolute right-[calc(-1*var(--homepage-workflow-popup-overhang))] bottom-4 left-[clamp(0.5rem,3vw,1.5rem)] z-[2] w-auto min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-[0_18px_44px_rgba(15,23,42,0.08)] transition-[opacity,transform] duration-200 [--homepage-workflow-popup-overhang:clamp(0rem,calc((100vw-72rem)*0.5),4rem)] data-[popup-visible=false]:translate-y-3 data-[popup-visible=false]:scale-[0.98] data-[popup-visible=false]:pointer-events-none data-[popup-visible=false]:opacity-0 data-[popup-visible=true]:translate-y-0 data-[popup-visible=true]:scale-100 data-[popup-visible=true]:opacity-100 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-50 dark:shadow-[0_18px_44px_rgba(0,0,0,0.28)] max-[899px]:right-2 max-[899px]:bottom-2 max-[899px]:left-2 max-[899px]:[--homepage-workflow-popup-overhang:0rem] max-[520px]:right-1.5 max-[520px]:bottom-1.5 max-[520px]:left-1.5"
      data-homepage-workflow-popup=""
      data-popup-visible={visible ? "true" : "false"}
      data-testid="homepage-workflow-popup"
    >
      <div
        className="flex h-10 items-center justify-between gap-4 border-b border-slate-200 bg-white px-4 text-xs font-bold text-stone-500 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-400 max-[520px]:px-3"
        data-testid="homepage-workflow-popup-header"
      >
        <div
          className="flex items-center gap-1.5"
          aria-hidden="true"
          data-testid="homepage-workflow-popup-traffic-lights"
        >
          <span
            className="inline-flex size-[0.65rem] rounded-full bg-rose-500"
            data-testid="homepage-workflow-popup-traffic-light"
          />
          <span
            className="inline-flex size-[0.65rem] rounded-full bg-amber-400"
            data-testid="homepage-workflow-popup-traffic-light"
          />
          <span
            className="inline-flex size-[0.65rem] rounded-full bg-emerald-500"
            data-testid="homepage-workflow-popup-traffic-light"
          />
        </div>
        <div className="flex min-w-0 items-center gap-1.5">
          <FileText className="size-3.5 shrink-0" aria-hidden="true" />
        </div>
      </div>
      <div
        className="relative min-h-[28rem] overflow-hidden bg-stone-50 p-4 [--homepage-workflow-document-offset-y:0rem] [--homepage-workflow-document-scale:1] dark:bg-slate-900 min-[780px]:min-h-[25.5rem] min-[780px]:[--homepage-workflow-document-scale:0.6] max-[899px]:min-h-[14.5rem] max-[899px]:p-2.5 max-[899px]:[--homepage-workflow-document-offset-y:clamp(1rem,5svh,2.75rem)] max-[899px]:[--homepage-workflow-document-scale:0.66] max-[520px]:p-3 max-[520px]:[--homepage-workflow-document-scale:0.6]"
        data-homepage-workflow-review-visible={
          showUserFeedback ? "true" : "false"
        }
        data-testid="homepage-workflow-document-workspace"
      >
        <div
          className="relative w-full min-w-0 origin-top-left transform-[translateY(var(--homepage-workflow-document-offset-y))_scale(var(--homepage-workflow-document-scale))] min-[780px]:w-[calc(100%/var(--homepage-workflow-document-scale))] max-[899px]:w-[calc(100%/var(--homepage-workflow-document-scale))]"
          data-homepage-workflow-document-scale=""
          data-testid="homepage-workflow-document-scale"
        >
          {showDoneButton ? (
            <Button
              className="absolute top-3 right-3 z-[3] h-12 rounded-[7px] bg-black px-4.5 text-base font-bold text-white shadow-[0_10px_28px_rgba(0,0,0,0.18)] hover:bg-black/85"
              data-testid="homepage-workflow-handoff-button"
              type="button"
              size="sm"
            >
              <Check className="size-6" aria-hidden="true" />
              I'm done
            </Button>
          ) : null}
          <div
            className={cn(
              "mx-auto grid max-w-[39rem] min-w-0 items-start gap-4 transition-[max-width,grid-template-columns] duration-200",
              showUserFeedback
                ? "max-w-full min-[780px]:max-w-[56rem] min-[780px]:grid-cols-[minmax(0,1fr)_minmax(11rem,0.48fr)] min-[780px]:gap-5 max-[899px]:max-w-[46rem] max-[899px]:grid-cols-[minmax(0,1fr)_minmax(10rem,0.44fr)] max-[899px]:gap-[0.85rem]"
                : "max-w-[39rem]",
            )}
            data-testid={
              showUserFeedback
                ? "homepage-workflow-document-shell-with-comments"
                : "homepage-workflow-document-shell-no-comments"
            }
            ref={documentShellRef}
          >
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2 px-1 pb-3 font-mono text-[0.7rem] font-medium text-stone-400 dark:text-slate-400">
                <button
                  aria-label="Switch editor view"
                  className="grid h-[1.375rem] grid-cols-[repeat(2,1.625rem)] items-center rounded-full bg-[#DED8CE] p-0.5 shadow-[inset_0_1px_0_rgba(255,251,245,0.72)] dark:bg-slate-700 dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]"
                  type="button"
                >
                  <span className="flex h-[1.125rem] items-center justify-center rounded-full bg-[#FFFDFC] text-stone-700 shadow-[0_1px_2px_rgba(41,37,36,0.12)] dark:bg-slate-500 dark:text-white">
                    <Eye className="size-3" aria-hidden="true" />
                  </span>
                  <span className="flex h-[1.125rem] items-center justify-center rounded-full text-stone-500 dark:text-slate-400">
                    <CodeXml className="size-3" aria-hidden="true" />
                  </span>
                </button>
                <span className="min-w-0 truncate text-stone-600 dark:text-slate-400">
                  homepage-conversion-plan.md
                </span>
                <span className="ml-auto inline-flex items-center gap-1 text-stone-400 dark:text-slate-400 max-[520px]:hidden">
                  <PencilLine className="size-3" aria-hidden="true" />
                  editing
                </span>
              </div>
              <div
                className="min-h-[25rem] rounded-xl border border-[#E9E9E8] bg-white p-[clamp(2rem,6vw,3.5rem)] shadow-[0_18px_44px_rgba(57,47,38,0.08)] dark:border-slate-700 dark:bg-slate-900 dark:shadow-[0_18px_44px_rgba(0,0,0,0.35)] max-[899px]:min-h-[19rem] max-[899px]:p-6"
                ref={documentPageRef}
              >
                <p className="m-0 mb-4 text-[0.72rem] leading-none font-semibold tracking-[0.14em] text-stone-600 uppercase dark:text-slate-400">
                  Roughdraft
                </p>
                <h3
                  className="m-0 mb-6 text-[clamp(1.6rem,4vw,2.35rem)] leading-[1.1] font-semibold text-slate-950 dark:text-slate-50"
                  data-testid="homepage-workflow-document-title"
                >
                  Homepage Conversion Plan
                </h3>
                <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                  Move the workflow story above{" "}
                  {showUserFeedback ? (
                    <span
                      className="bg-[#FFF5C7] decoration-clone box-decoration-clone dark:bg-amber-900/35"
                      data-comment-ids='["nora-comment"]'
                      data-testid="homepage-workflow-comment-highlight"
                    >
                      "It's just Markdown."
                    </span>
                  ) : (
                    '"It\'s just Markdown."'
                  )}
                </p>
                <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                  Show the agent pause, the review window, and the resume
                  signal.
                </p>
                <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                  Keep the format section as proof that the review data is
                  portable Markdown.
                </p>
                {showUserFeedback ? (
                  <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                    <span
                      className="rounded-[0.2rem] bg-rose-50 text-rose-900 line-through decoration-rose-600/75 dark:bg-rose-900/35 dark:text-rose-300"
                      data-comment-ids='["nora-suggestion"]'
                      data-testid="homepage-workflow-suggestion-old"
                    >
                      Review an agent's plan
                    </span>{" "}
                    <span
                      className="rounded-[0.2rem] bg-emerald-50 text-emerald-800 underline decoration-emerald-500/75 underline-offset-[0.16em] dark:bg-emerald-950/50 dark:text-emerald-300"
                      data-comment-ids='["nora-suggestion"]'
                      data-testid="homepage-workflow-suggestion-new"
                    >
                      Review a homepage plan
                    </span>{" "}
                    before it starts coding.
                  </p>
                ) : showIncorporatedPlan ? (
                  <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                    Review a homepage plan before it starts coding.
                  </p>
                ) : (
                  <p className="m-0 mb-4 text-[clamp(0.95rem,2.25vw,1.12rem)] leading-[1.65] text-stone-700 dark:text-stone-300">
                    Review an agent's plan before it starts coding.
                  </p>
                )}
              </div>
            </div>
            {showUserFeedback ? (
              <div
                className="relative min-h-[25rem] min-w-0 text-stone-700"
                data-testid="homepage-workflow-review-rail"
                ref={reviewRailRef}
              >
                {HOMEPAGE_WORKFLOW_REVIEW_ITEMS.map((item) => {
                  const layout = reviewLayouts.find(
                    (reviewLayout) => reviewLayout.key === item.key,
                  );

                  return (
                    <div
                      className="homepage-workflow-review-thread absolute right-0 left-0 grid grid-cols-[2rem_minmax(0,1fr)] items-start gap-3 transition-[top] duration-200"
                      key={item.key}
                      ref={(node) => setThreadRef(item.key, node)}
                      style={layout ? { top: layout.railTop } : undefined}
                    >
                      <div className="flex size-8 items-center justify-center rounded-full border border-stone-300 bg-[#E7E0D5] text-[0.72rem] font-bold text-stone-700">
                        N
                      </div>
                      <div>
                        <div className="mb-1 text-[0.85rem] font-bold text-slate-950 dark:text-slate-50">
                          {item.author}
                        </div>
                        <p
                          className="m-0 text-[0.8rem] leading-[1.65] text-stone-700 dark:text-stone-300"
                          data-testid={
                            item.kind === "comment"
                              ? "homepage-workflow-review-comment"
                              : undefined
                          }
                        >
                          {item.body}
                        </p>
                        {showAgentReply
                          ? item.replies?.map((reply) => (
                              <div
                                className="mt-3 grid grid-cols-[1.65rem_minmax(0,1fr)] gap-2.5 border-t border-stone-200 pt-3"
                                key={`${item.key}-${reply.author}`}
                              >
                                <div className="flex size-[1.65rem] items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-[0.62rem] font-bold text-sky-700">
                                  {reply.author}
                                </div>
                                <div>
                                  <div className="mb-0.5 text-[0.76rem] font-bold text-slate-950 dark:text-slate-50">
                                    {reply.author}
                                  </div>
                                  <p className="m-0 text-[0.8rem] leading-[1.65] text-stone-700 dark:text-stone-300">
                                    {reply.body}
                                  </p>
                                </div>
                              </div>
                            ))
                          : null}
                        {item.kind === "suggestion" ? (
                          <div className="mt-2 flex gap-3 text-[0.95rem] text-stone-400">
                            <Check className="size-3.5" aria-hidden="true" />
                            <span aria-hidden="true">×</span>
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function RoughdraftFlavoredMarkdownPage() {
  return (
    <main className="min-h-screen bg-[#FCFCFC] dark:bg-background px-6 py-8 text-slate-950 dark:text-slate-50">
      <div className="mx-auto max-w-5xl">
        <Button
          className="h-9 gap-2 px-3 text-sm"
          nativeButton={false}
          variant="ghost"
          render={
            <a href="/">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to Roughdraft
            </a>
          }
        />

        <section className="mt-12 max-w-3xl">
          <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
            Roughdraft flavored Markdown
          </p>
          <h1 className="mt-3 text-4xl leading-tight font-semibold text-balance text-slate-950 dark:text-slate-50 sm:text-5xl">
            Markdown with review comments and suggested changes
          </h1>
          <p className="mt-5 text-lg leading-8 text-stone-600 dark:text-stone-400">
            Roughdraft Flavored Markdown is regular Markdown plus portable
            review markup. It builds on{" "}
            <a
              className="font-medium text-slate-950 dark:text-slate-50 underline decoration-slate-300 dark:decoration-slate-600 underline-offset-4 hover:decoration-slate-950 dark:hover:decoration-slate-50"
              href="https://criticmarkup.com/"
              target="_blank"
              rel="noreferrer"
            >
              CriticMarkup
            </a>{" "}
            syntax and the text-first model behind{" "}
            <a
              className="font-medium text-slate-950 dark:text-slate-50 underline decoration-slate-300 dark:decoration-slate-600 underline-offset-4 hover:decoration-slate-950 dark:hover:decoration-slate-50"
              href="https://developers.notion.com/guides/data-apis/enhanced-markdown"
              target="_blank"
              rel="noreferrer"
            >
              Notion-flavored Markdown
            </a>
            {", "}
            so a person and a coding agent can review the same file without a
            sidecar database or hosted document format.
          </p>
        </section>

        <section className="mt-10 grid gap-3 md:grid-cols-2">
          {ROUGHDRAFT_MARKDOWN_REFERENCES.map(
            ({ description, href, title }) => (
              <a
                className="group rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)] transition hover:border-slate-300 dark:hover:border-slate-600 hover:shadow-[0_14px_34px_rgba(15,23,42,0.08)] dark:hover:shadow-[0_14px_34px_rgba(0,0,0,0.4)]"
                href={href}
                key={title}
                target="_blank"
                rel="noreferrer"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-semibold text-slate-950 dark:text-slate-50">
                    {title}
                  </h2>
                  <ExternalLink
                    className="size-4 text-stone-400 dark:text-stone-500 transition group-hover:text-stone-700 dark:group-hover:text-stone-300"
                    aria-hidden="true"
                  />
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {description}
                </p>
              </a>
            ),
          )}
        </section>

        <section className="mt-12 grid gap-4 md:grid-cols-3">
          {[
            {
              title: "Plain text first",
              description:
                "The saved file remains readable in editors, terminals, git diffs, and agent context windows.",
              icon: FileText,
            },
            {
              title: "Threaded review",
              description:
                "Comments carry document-local ids, authors, timestamps, and reply links for back-and-forth discussion.",
              icon: MessageSquare,
            },
            {
              title: "Explicit edits",
              description:
                "Suggestions are represented as insertions, deletions, and substitutions until someone accepts them.",
              icon: PencilLine,
            },
          ].map(({ description, icon: Icon, title }) => (
            <div
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 shadow-[0_10px_30px_rgba(15,23,42,0.05)] dark:shadow-[0_10px_30px_rgba(0,0,0,0.3)]"
              key={title}
            >
              <div className="flex size-10 items-center justify-center rounded-md border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-stone-700 dark:text-stone-300">
                <Icon className="size-4" aria-hidden="true" />
              </div>
              <h2 className="mt-4 text-base font-semibold text-slate-950 dark:text-slate-50">
                {title}
              </h2>
              <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                {description}
              </p>
            </div>
          ))}
        </section>

        <section className="mt-14 grid gap-8 lg:grid-cols-[0.75fr_1.25fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Format contract
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              Review data lives where agents can inspect it
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Roughdraft treats the Markdown file as the durable source of
              truth. The rich editor can add affordances around the text, but
              the saved representation needs to be readable in a terminal,
              reviewable in git, and understandable to another agent without
              loading Roughdraft.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            {ROUGHDRAFT_MARKDOWN_CONTRACT.map(({ description, title }) => (
              <div
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                key={title}
              >
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {description}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Syntax
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              The review layer is small on purpose
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Roughdraft uses CriticMarkup-compatible markers for comments,
              highlights, insertions, deletions, and substitutions. Roughdraft
              extends those markers with document-local metadata so review
              threads, authorship, timestamps, and suggested-change discussions
              can survive in the Markdown file itself.
            </p>
          </div>

          <div className="grid gap-3">
            {ROUGHDRAFT_MARKDOWN_SYNTAX.map(
              ({ description, label, syntax }) => (
                <div
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                  key={label}
                >
                  <div className="flex items-center gap-2">
                    <Braces
                      className="size-4 text-stone-500 dark:text-stone-400"
                      aria-hidden="true"
                    />
                    <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                      {label}
                    </h3>
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                    {description}
                  </p>
                  <code className="mt-3 block overflow-x-auto rounded-md border border-slate-200 dark:border-slate-700 bg-[#FAFAF8] dark:bg-slate-800 px-3 py-2 text-xs text-stone-700 dark:text-stone-300">
                    {syntax}
                  </code>
                </div>
              ),
            )}
          </div>
        </section>

        <section className="mt-14 grid gap-8 border-t border-slate-200 dark:border-slate-700 pt-10 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-stone-500 dark:text-stone-400 uppercase">
              Roughdraft extensions
            </p>
            <h2 className="mt-3 text-3xl leading-tight font-semibold text-slate-950 dark:text-slate-50">
              The extra fields make review state portable
            </h2>
            <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
              Standard CriticMarkup captures the visible annotation. Roughdraft
              keeps the same readable markers, adds compact inline references,
              and stores review metadata in final YAML endmatter.
            </p>
          </div>

          <div className="grid gap-3">
            {ROUGHDRAFT_MARKDOWN_EXTENSION_DETAILS.map(({ body, title }) => (
              <div
                className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4"
                key={title}
              >
                <h3 className="text-sm font-semibold text-slate-950 dark:text-slate-50">
                  {title}
                </h3>
                <p className="mt-2 text-sm leading-6 text-stone-600 dark:text-stone-400">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-14 max-w-3xl border-t border-slate-200 dark:border-slate-700 pt-10">
          <h2 className="text-2xl font-semibold text-slate-950 dark:text-slate-50">
            What this is not
          </h2>
          <p className="mt-4 text-base leading-7 text-stone-600 dark:text-stone-400">
            It is not a new replacement for Markdown, and it is not a hidden app
            state format. If Roughdraft adds review information, that
            information should stay visible, portable, and understandable in the
            Markdown file itself.
          </p>
        </section>
      </div>
    </main>
  );
}

function createPreviewPage(): Page {
  return {
    id: "preview",
    title: "Live Preview",
    content: PREVIEW_INITIAL_MARKDOWN,
    version: "memory:initial",
  };
}

export function PreviewPage() {
  const [backend] = useState(() => new PreviewBackend(createPreviewPage()));
  const [previewPage, setPreviewPage] = useState<Page>(() =>
    backend.getCurrentPage(),
  );
  const [previewForceResetKey, setPreviewForceResetKey] = useState<
    string | null
  >(null);
  const [editorViewMode, setEditorViewMode] = useState<DocumentEditorViewMode>(
    () => getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const [, setSaveState] = useState<DocumentSaveState>("saved");

  useEffect(() => () => backend.dispose(), [backend]);

  useEffect(() => {
    document.title = "Roughdraft Preview";
  }, []);

  const handleSaveDocument = useCallback(
    async (_id: string, content: string) => {
      const savedPage = await backend.saveMarkdownFile(
        PREVIEW_DOCUMENT_PATH,
        content,
      );
      setPreviewPage(savedPage);
    },
    [backend],
  );

  const handleResetPreview = useCallback(async () => {
    const freshBackendPage = createPreviewPage();
    const savedPage = await backend.saveMarkdownFile(
      PREVIEW_DOCUMENT_PATH,
      freshBackendPage.content,
    );
    setPreviewPage(savedPage);
    setPreviewForceResetKey(`preview-reset:${Date.now()}`);
  }, [backend]);

  const handleCompletePreviewReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      return backend.completeReview
        ? backend.completeReview(PREVIEW_DOCUMENT_PATH, options)
        : { delivered: false };
    },
    [backend],
  );

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      <DocumentWorkspace
        documentPage={previewPage}
        activeDocumentPath={PREVIEW_DOCUMENT_PATH}
        documentCopyPath={PREVIEW_DOCUMENT_PATH}
        documentFilenameLabel={PREVIEW_DOCUMENT_PATH}
        documentEditorViewMode={editorViewMode}
        onDocumentEditorViewModeChange={setEditorViewMode}
        onSaveDocument={handleSaveDocument}
        onDocumentSaveStateChange={setSaveState}
        onDocumentDirtyStateChange={() => {}}
        onDocumentLocalContentChange={() => {}}
        documentDiskChangeState="clean"
        documentForceResetKey={previewForceResetKey}
        onReloadDocumentFromDisk={handleResetPreview}
        onKeepEditingWithoutAutosave={() => {}}
        onOverwriteDocumentOnDisk={() => {}}
        onCompleteReview={handleCompletePreviewReview}
        backend={backend}
      />
    </main>
  );
}

export function App() {
  const initialRequestedPathState = getRequestedPathState();
  const [requestedPathState] = useState(initialRequestedPathState);
  const isRoughdraftFlavoredMarkdownRoute =
    window.location.pathname === ROUGHDRAFT_FLAVORED_MARKDOWN_PATH;
  const isPreviewRoute = window.location.pathname === PREVIEW_PATH;
  const [backend, setBackend] = useState<StorageBackend | null>(null);
  const [documentPage, setDocumentPage] = useState<Page | null>(null);
  const [activeDocumentPath, setActiveDocumentPath] = useState<string | null>(
    initialRequestedPathState.documentPath,
  );
  const [documentSaveState, setDocumentSaveState] =
    useState<DocumentSaveState>("saved");
  const [documentDiskChangeState, setDocumentDiskChangeState] =
    useState<DocumentDiskChangeState>("clean");
  const [documentForceResetKey, setDocumentForceResetKey] = useState<
    string | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [documentEditorViewMode, setDocumentEditorViewMode] = useState(() =>
    getDocumentEditorViewModeFromLocation("rich-text"),
  );
  const backendRef = useRef<StorageBackend | null>(null);
  const documentPageRef = useRef<Page | null>(null);
  const activeDocumentPathRef = useRef<string | null>(activeDocumentPath);
  const documentDirtyRef = useRef(false);
  const documentSaveStateRef = useRef<DocumentSaveState>("saved");
  const documentDraftContentRef = useRef<string | null>(null);

  backendRef.current = backend;
  documentPageRef.current = documentPage;
  activeDocumentPathRef.current = activeDocumentPath;
  documentSaveStateRef.current = documentSaveState;

  const applyDocumentPage = useCallback((nextDocument: Page) => {
    setDocumentPage(nextDocument);
    documentDraftContentRef.current = nextDocument.content;
  }, []);

  const loadDocument = useCallback(
    async (nextBackend: StorageBackend, relativePath: string) => {
      const nextDocument = await nextBackend.getMarkdownFile(relativePath);
      applyDocumentPage(nextDocument);
      setActiveDocumentPath(relativePath);
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");
      return nextDocument;
    },
    [applyDocumentPage],
  );

  useEffect(() => {
    let cancelled = false;

    const loadUpdateStatus = async () => {
      const nextUpdateStatus = await fetchUpdateStatus();
      if (!cancelled) {
        setUpdateStatus(nextUpdateStatus);
      }
    };

    void loadUpdateStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const sourceUrl = new URL("/api/open-requests", window.location.origin);
    if (requestedPathState.rawPath) {
      sourceUrl.searchParams.set("path", requestedPathState.rawPath);
    }

    const source = new EventSource(`${sourceUrl.pathname}${sourceUrl.search}`);
    const handleOpenRequest = (event: Event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as {
          url?: unknown;
        };
        if (typeof payload.url !== "string" || !payload.url.trim()) return;

        const nextUrl = new URL(payload.url, window.location.origin);
        window.focus();
        if (nextUrl.href !== window.location.href) {
          window.location.assign(nextUrl.href);
        }
      } catch (error) {
        console.error("Failed to handle Roughdraft open request:", error);
      }
    };

    source.addEventListener("open-request", handleOpenRequest);

    return () => {
      source.removeEventListener("open-request", handleOpenRequest);
      source.close();
    };
  }, [requestedPathState.rawPath]);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      setLoading(true);
      setLoadError(null);
      setDocumentPage(null);

      try {
        const detectedBackend = await detectBackend();
        if (cancelled) return;

        setBackend(detectedBackend);

        if (detectedBackend.info.kind === "remote") {
          const documentPath = detectedBackend.info.detail || "remote.md";
          await loadDocument(detectedBackend, documentPath);
          if (cancelled) return;
          setLoading(false);
          return;
        }

        if (!requestedPathState.rawPath) {
          setActiveDocumentPath(null);
          setLoading(false);
          return;
        }

        syncRequestedPathInUrl(requestedPathState.rawPath);

        if (
          !requestedPathState.projectPath ||
          !requestedPathState.documentPath
        ) {
          setActiveDocumentPath(null);
          setLoadError("Roughdraft now opens one .md file at a time.");
          setLoading(false);
          return;
        }

        if (detectedBackend.canManageProjects) {
          await detectedBackend.openProject(requestedPathState.projectPath);
        }

        if (cancelled) return;

        await loadDocument(detectedBackend, requestedPathState.documentPath);
        if (cancelled) return;

        setLoading(false);
      } catch (error) {
        if (cancelled) return;

        console.error("Failed to open markdown file:", error);
        setActiveDocumentPath(null);
        setLoadError("Could not open that markdown file.");
        setLoading(false);
      }
    };

    void initialize();

    return () => {
      cancelled = true;
    };
  }, [
    loadDocument,
    requestedPathState.documentPath,
    requestedPathState.projectPath,
    requestedPathState.rawPath,
  ]);

  useEffect(() => {
    const workspaceTitlePath = activeDocumentPath
      ? formatWorkspacePathForDisplay(
          backend?.info.projectPath
            ? joinPath(backend.info.projectPath, activeDocumentPath)
            : requestedPathState.rawPath,
        )
      : null;

    document.title = isPreviewRoute
      ? "Roughdraft Preview"
      : isRoughdraftFlavoredMarkdownRoute
        ? "Roughdraft Flavored Markdown"
        : (workspaceTitlePath ?? "Roughdraft");
  }, [
    activeDocumentPath,
    backend,
    isRoughdraftFlavoredMarkdownRoute,
    isPreviewRoute,
    requestedPathState.rawPath,
  ]);

  const handleSaveDocument = useCallback(
    async (id: string, content: string) => {
      if (!activeDocumentPath) return;
      const expectedVersion =
        documentPageRef.current?.id === id
          ? documentPageRef.current.version
          : undefined;

      let savedDocument: Page | undefined;
      try {
        savedDocument = await backendRef.current?.saveMarkdownFile(
          activeDocumentPath,
          content,
          expectedVersion,
        );
      } catch (error) {
        if (error instanceof MarkdownFileConflictError) {
          setDocumentDiskChangeState("conflict");
        }
        throw error;
      }

      const firstLine = content.split("\n")[0] || "";
      const fallbackTitle = id.split("/").at(-1) || id;
      const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;
      const nextDocument = savedDocument ?? {
        id,
        content,
        title,
        version: expectedVersion,
      };

      applyDocumentPage(nextDocument);
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");
    },
    [activeDocumentPath, applyDocumentPage],
  );

  const handleDocumentDirtyStateChange = useCallback((isDirty: boolean) => {
    documentDirtyRef.current = isDirty;
  }, []);

  const handleDocumentSaveStateChange = useCallback(
    (state: DocumentSaveState) => {
      documentSaveStateRef.current = state;
      setDocumentSaveState(state);
    },
    [],
  );

  const handleDocumentLocalContentChange = useCallback((markdown: string) => {
    documentDraftContentRef.current = markdown;
  }, []);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (
        !shouldWarnBeforeUnload({
          activeDocumentPath: activeDocumentPathRef.current,
          isDirty: documentDirtyRef.current,
          saveState: documentSaveStateRef.current,
          diskChangeState: documentDiskChangeState,
        })
      ) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [documentDiskChangeState]);

  const handleReloadDocumentFromDisk = useCallback(async () => {
    const currentBackend = backendRef.current;
    const currentPath = activeDocumentPathRef.current;
    if (!currentBackend || !currentPath) return;

    const nextDocument = await currentBackend.getMarkdownFile(currentPath);
    applyDocumentPage(nextDocument);
    documentDirtyRef.current = false;
    setDocumentDiskChangeState("clean");
    setDocumentForceResetKey(
      `${currentPath}:${nextDocument.version ?? Date.now()}`,
    );
  }, [applyDocumentPage]);

  const handleKeepEditingWithoutAutosave = useCallback(() => {
    setDocumentDiskChangeState("paused");
  }, []);

  const handleOverwriteDocumentOnDisk = useCallback(async () => {
    const currentBackend = backendRef.current;
    const currentPath = activeDocumentPathRef.current;
    const currentDocument = documentPageRef.current;
    if (!currentBackend || !currentPath || !currentDocument) return;

    const content = documentDraftContentRef.current ?? currentDocument.content;
    const firstLine = content.split("\n")[0] || "";
    const fallbackTitle =
      currentDocument.id.split("/").at(-1) || currentDocument.id;
    const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;
    const savedDocument = (await currentBackend.saveMarkdownFile(
      currentPath,
      content,
    )) ?? {
      ...currentDocument,
      content,
      title,
    };

    applyDocumentPage(savedDocument);
    documentDirtyRef.current = false;
    handleDocumentSaveStateChange("saved");
    setDocumentDiskChangeState("clean");
    setDocumentForceResetKey(
      `${currentPath}:${savedDocument.version ?? Date.now()}:overwrite`,
    );
  }, [applyDocumentPage, handleDocumentSaveStateChange]);

  const handleCompleteReview = useCallback(
    async (options?: CompleteReviewOptions) => {
      const currentBackend = backendRef.current;
      const currentPath = activeDocumentPathRef.current;
      const currentDocument = documentPageRef.current;
      if (!currentBackend || !currentPath || !currentDocument) {
        return { delivered: false };
      }

      const content =
        documentDraftContentRef.current ?? currentDocument.content;
      const expectedVersion = currentDocument.version;
      const firstLine = content.split("\n")[0] || "";
      const fallbackTitle =
        currentDocument.id.split("/").at(-1) || currentDocument.id;
      const title = firstLine.replace(/^#*\s*/, "") || fallbackTitle;

      const savedDocument = (await currentBackend.saveMarkdownFile(
        currentPath,
        content,
        expectedVersion,
      )) ?? {
        ...currentDocument,
        content,
        title,
      };

      applyDocumentPage(savedDocument);
      documentDirtyRef.current = false;
      setDocumentDiskChangeState("clean");

      return currentBackend.completeReview
        ? currentBackend.completeReview(currentPath, options)
        : { delivered: false };
    },
    [applyDocumentPage],
  );

  useEffect(() => {
    if (!backend?.watchMarkdownFile || !activeDocumentPath) return;

    let disposed = false;
    const stopWatching = backend.watchMarkdownFile(
      activeDocumentPath,
      (event) => {
        if (disposed || event.path !== activeDocumentPath) return;

        const currentDocument = documentPageRef.current;
        if (event.version && currentDocument?.version === event.version) {
          return;
        }

        if (!event.exists) {
          setDocumentDiskChangeState("changed");
          return;
        }

        if (documentDiskChangeState === "paused") {
          return;
        }

        if (documentDirtyRef.current) {
          setDocumentDiskChangeState("changed");
          return;
        }

        void (async () => {
          const currentBackend = backendRef.current;
          const currentPath = activeDocumentPathRef.current;
          if (!currentBackend || !currentPath || disposed) return;

          try {
            const nextDocument =
              await currentBackend.getMarkdownFile(currentPath);
            if (disposed) return;
            applyDocumentPage(nextDocument);
            setDocumentDiskChangeState("clean");
          } catch (error) {
            console.error("Failed to reload changed markdown file:", error);
          }
        })();
      },
    );

    return () => {
      disposed = true;
      stopWatching();
    };
  }, [activeDocumentPath, applyDocumentPage, backend, documentDiskChangeState]);

  const handleDocumentEditorViewModeChange = useCallback(
    (nextMode: DocumentEditorViewMode) => {
      setDocumentEditorViewMode((current) => {
        if (nextMode === current) return current;
        window.history.replaceState(
          null,
          "",
          buildLocationForDocumentEditorViewMode(nextMode),
        );
        return nextMode;
      });
    },
    [],
  );

  if (loading) {
    return (
      <div
        className="h-screen bg-[#FCFCFC] dark:bg-background"
        aria-hidden="true"
      />
    );
  }

  if (isRoughdraftFlavoredMarkdownRoute) {
    return <RoughdraftFlavoredMarkdownPage />;
  }

  if (isPreviewRoute) {
    return <PreviewPage />;
  }

  if (!requestedPathState.rawPath || loadError) {
    return (
      <Homepage
        message={loadError ?? <HomepageSubtitle />}
        updateStatus={updateStatus}
      />
    );
  }

  const documentAbsolutePath =
    activeDocumentPath && backend?.info.projectPath
      ? joinPath(backend.info.projectPath, activeDocumentPath)
      : requestedPathState.rawPath;
  const documentFilenameLabel =
    getPathLeaf(documentAbsolutePath ?? activeDocumentPath) ?? "Untitled.md";

  return (
    <main className="relative flex h-screen min-w-0 flex-col overflow-hidden bg-[#FCFCFC] dark:bg-background text-slate-950 dark:text-slate-50">
      {updateStatus ? (
        <div className="pointer-events-none absolute top-4 right-4 z-40 max-w-sm">
          <div className="pointer-events-auto">
            <UpdateNotice updateStatus={updateStatus} />
          </div>
        </div>
      ) : null}
      <DocumentWorkspace
        documentPage={documentPage}
        activeDocumentPath={activeDocumentPath}
        documentCopyPath={documentAbsolutePath}
        documentFilenameLabel={documentFilenameLabel}
        documentEditorViewMode={documentEditorViewMode}
        onDocumentEditorViewModeChange={handleDocumentEditorViewModeChange}
        onSaveDocument={handleSaveDocument}
        onDocumentSaveStateChange={handleDocumentSaveStateChange}
        onDocumentDirtyStateChange={handleDocumentDirtyStateChange}
        onDocumentLocalContentChange={handleDocumentLocalContentChange}
        documentDiskChangeState={documentDiskChangeState}
        documentForceResetKey={documentForceResetKey}
        onReloadDocumentFromDisk={handleReloadDocumentFromDisk}
        onKeepEditingWithoutAutosave={handleKeepEditingWithoutAutosave}
        onOverwriteDocumentOnDisk={handleOverwriteDocumentOnDisk}
        onCompleteReview={handleCompleteReview}
        backend={backend}
      />
    </main>
  );
}
