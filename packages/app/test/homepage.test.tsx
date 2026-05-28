import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  Homepage,
  HomepageSubtitle,
  PreviewPage,
  RoughdraftFlavoredMarkdownPage,
} from "../src/App";

const AGENT_SETUP_PROMPT =
  "Install Roughdraft for me using `npm i -g roughdraft`, then read https://roughdraft.md/setup.md and set yourself up to use it.";

function createDomRect({
  left = 0,
  top = 0,
  width = 120,
  height = 24,
}: {
  left?: number;
  top?: number;
  width?: number;
  height?: number;
} = {}) {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
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

async function renderHomepage(root: Root) {
  await act(async () => {
    root.render(
      <Homepage message={<HomepageSubtitle />} updateStatus={null} />,
    );
    await Promise.resolve();
  });
}

describe("Homepage", () => {
  let container: HTMLDivElement;
  let root: Root;
  let writeText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
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

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    writeText = vi.fn().mockResolvedValue(undefined);

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      createDomRect({ width: 640, height: 480 }),
    );
    Object.defineProperty(Range.prototype, "getBoundingClientRect", {
      configurable: true,
      value() {
        return createDomRect({ width: 80, height: 20 });
      },
    });
    Object.defineProperty(Range.prototype, "getClientRects", {
      configurable: true,
      value() {
        return [createDomRect({ width: 80, height: 20 })];
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
        return [createDomRect({ width: 80, height: 20 })];
      },
    });
  });

  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens the agent setup prompt from the CTA and copies it", async () => {
    await renderHomepage(root);

    expect(container.textContent).toContain(
      "Easier collaborationwith your agent",
    );
    expect(getByTestId(container, "homepage").className).toContain("pt-8");
    expect(getByTestId(container, "homepage").className).toContain(
      "items-start",
    );
    expect(container.textContent).toContain("roughdraft.md");
    const homepageLogo = getByTestId(container, "homepage-logo");
    expect(homepageLogo?.textContent).toBe("roughdraft.md");
    expect(homepageLogo?.className).toContain("text-[clamp(");
    expect(homepageLogo?.className).not.toContain("tracking-");
    expect(container.textContent).toContain(
      "Refine complex ideas with comments and suggestions.",
    );
    expect(container.textContent).toContain("Free, open source, local.");
    expect(getByTestId(container, "homepage-subtitle-break")).not.toBeNull();
    expect(
      getByTestId(container, "homepage-subtitle-comment").className,
    ).toContain("bg-[#fff5c7]");
    expect(
      getByTestId(container, "homepage-subtitle-addition").className,
    ).toContain("bg-emerald-50");
    expect(
      getByTestId(container, "homepage-subtitle-addition").className,
    ).toContain("underline");
    const homepageHeading = getByTestId(container, "homepage-heading");
    expect(getByTestId(container, "homepage-heading-break")).not.toBeNull();
    const homepageTextWrapper = homepageHeading?.parentElement?.parentElement;
    expect(homepageHeading?.parentElement?.className).toContain("mt-20");
    expect(homepageHeading?.parentElement?.className).toContain("sm:mt-28");
    expect(homepageTextWrapper?.className).toContain("text-left");
    expect(homepageTextWrapper?.className).toContain("max-w-[100rem]");
    expect(homepageTextWrapper?.className).not.toContain("font-bold");
    expect(homepageHeading?.className).not.toContain("max-w-");
    expect(homepageHeading?.className).toContain("text-[clamp(");
    expect(homepageHeading?.className).toContain(
      "text-[clamp(2.875rem,14.2vw,5rem)]",
    );
    expect(homepageHeading?.className).toContain("leading-[0.88]");
    expect(homepageHeading?.className).not.toContain("text-balance");
    expect(homepageHeading?.nextElementSibling?.className).toContain(
      "text-[clamp(",
    );
    expect(homepageHeading?.nextElementSibling?.className).toContain(
      "leading-none",
    );
    expect(homepageHeading?.nextElementSibling?.className).toContain(
      "max-w-5xl",
    );
    expect(homepageHeading?.nextElementSibling?.className).not.toContain(
      "mx-auto",
    );
    expect(homepageHeading?.nextElementSibling?.className).not.toContain(
      "text-balance",
    );
    expect(homepageHeading?.nextElementSibling?.className).toContain(
      "text-slate-950",
    );
    expect(homepageHeading?.nextElementSibling?.className).toContain(
      "dark:text-slate-50",
    );
    expect(container.textContent).not.toContain("Open-source");
    expect(container.textContent).toContain("Roughdraft flavored Markdown");
    expect(container.textContent).toContain("It's just Markdown");
    expect(container.textContent).toContain(
      "We extended the markdown format, building on prior art like CriticMarkup",
    );
    expect(
      container.querySelector('a[href="https://criticmarkup.com/"]')
        ?.textContent,
    ).toContain("CriticMarkup");
    expect(container.textContent).toContain(
      "working with other major Markdown apps to rally support",
    );
    expect(container.textContent).toContain("# Homepage Conversion Plan");
    expect(container.textContent).toContain(
      'This should go above "It\'s just Markdown."',
    );
    expect(container.textContent).toContain("Review a homepage plan");
    expect(container.textContent).toContain("Review a spec");
    expect(container.textContent).toContain("Review a plan");
    expect(container.textContent).toContain("Edit writing");
    expect(getByTestId(container, "rfm-format-demo").className).toContain(
      "max-w-none",
    );
    expect(getByTestId(container, "rfm-format-demo-intro").className).toContain(
      "px-4",
    );
    expect(
      getByTestId(container, "rfm-format-demo-examples").className,
    ).toContain("px-4");
    const formatDemoArrow = getByTestId(container, "rfm-format-demo-arrow");
    expect(formatDemoArrow?.className).toContain("items-start");
    expect(getByTestId(container, "rfm-source-pane").textContent).toContain(
      "Source",
    );
    expect(getByTestId(container, "rfm-result-pane").textContent).toContain(
      "Result",
    );
    expect(getByTestId(container, "rfm-source-pane").className).toContain(
      "bg-transparent",
    );
    expect(getByTestId(container, "rfm-result-pane").className).toContain(
      "overflow-visible",
    );
    expect(getByTestId(container, "rfm-source-pane").className).toContain(
      "flex-col",
    );
    expect(
      getByTestId(container, "rfm-source-pane").querySelector(
        ".rfm-source-editor",
      )?.className,
    ).toContain("pt-10");
    expect(
      getByTestId(container, "rfm-source-pane").querySelector(
        ".rfm-source-editor",
      )?.className,
    ).toContain("[--cm-selection-bg:rgb(30_58_138_/_0.45)]");
    expect(
      getByTestId(container, "rfm-result-editor").querySelector(
        '[data-testid="document-page-shell"]',
      )?.className,
    ).toContain(
      "min-[900px]:grid-cols-[minmax(0,min(100%,42rem))_minmax(13rem,16rem)]",
    );
    const resultDocumentCard = getByTestId(
      container,
      "rfm-result-editor",
    ).querySelector('[data-testid="document-content-card"]');
    expect(resultDocumentCard?.className).toContain("bg-card");
    expect(resultDocumentCard?.className).toContain("shadow-");
    expect(queryByTestId(container, "rfm-token")).toBeNull();
    expect(
      container.querySelector(".comment-anchor[data-comment-ids]"),
    ).not.toBeNull();
    expect(
      container.querySelector(".critic-change[data-critic-change-id]"),
    ).not.toBeNull();
    expect(container.innerHTML).not.toContain(
      'contenteditable="plaintext-only"',
    );
    expect(
      getByTestId(container, "homepage-sneak-peek-image").getAttribute("src"),
    ).toBe("/sneak-peek.png");
    expect(
      getByTestId(container, "homepage-sneak-peek-image").parentElement
        ?.className,
    ).toContain("w-screen");
    expect(
      getByTestId(container, "homepage-sneak-peek-image").parentElement
        ?.className,
    ).toContain("-translate-x-6");
    expect(
      getByTestId(container, "homepage-sneak-peek-image").parentElement
        ?.className,
    ).toContain("max-w-[100rem]");
    expect(document.body.textContent).not.toContain(AGENT_SETUP_PROMPT);

    const cta = getByTestId<HTMLButtonElement>(
      container,
      "homepage-install-button",
    );
    expect(cta.textContent).toBe("Install now");
    expect(cta.className).toContain("h-14");
    expect(cta.className).toContain("cursor-pointer");
    expect(cta.className).toContain("px-5");
    expect(cta.className).toContain("text-[clamp(");
    const githubLink = container.querySelector(
      'a[href="https://github.com/Lex-Inc/roughdraft"]',
    );

    expect(container.textContent).not.toContain("Try live preview");
    expect(container.querySelector('a[href="/preview"]')).toBeNull();
    expect(githubLink?.textContent).toContain("View on GitHub");
    expect(githubLink?.getAttribute("target")).toBe("_blank");
    expect(githubLink?.getAttribute("rel")).toBe("noreferrer");
    expect(
      container.querySelector('a[href="/roughdraft-flavored-markdown"]')
        ?.textContent,
    ).toContain("spec");

    const planReviewButton = getByTestId<HTMLButtonElement>(
      container,
      "rfm-format-example-plan-review",
    );

    await click(planReviewButton);

    expect(container.textContent).toContain("Homepage Conversion Plan");
    expect(container.textContent).toContain(
      "Keep the format section as proof that the review data is portable Markdown.",
    );
    expect(container.textContent).toContain(
      'Replace: "Review an agent\'s plan" with "Review a homepage plan"',
    );

    await click(cta);

    expect(document.body.textContent).toContain(
      "Give this to your coding agent",
    );
    expect(document.body.textContent).toContain(AGENT_SETUP_PROMPT);

    const copyButton = getByTestId<HTMLButtonElement>(
      document.body,
      "homepage-copy-prompt-button",
    );

    await click(copyButton);

    expect(writeText).toHaveBeenCalledWith(AGENT_SETUP_PROMPT);
    expect(document.body.textContent).toContain("Copied");
  });

  it("explains the plan-review workflow with scrolling steps and a sticky visual", async () => {
    await renderHomepage(root);

    const text = container.textContent ?? "";
    expect(text).toContain("How it works");

    const storyboard = getByTestId(container, "homepage-workflow-storyboard");
    expect(storyboard.getAttribute("aria-labelledby")).toBe(
      "homepage-workflow-heading",
    );
    expect(
      getByTestId(storyboard, "homepage-workflow-heading").textContent,
    ).toBe("How it works");
    expect(
      getByTestId(storyboard, "homepage-workflow-heading").className,
    ).toContain("text-[clamp(");
    expect(
      getByTestId(storyboard, "homepage-workflow-heading").className,
    ).toContain("text-slate-950");
    expect(
      getByTestId(storyboard, "homepage-workflow-heading").className,
    ).toContain("dark:text-slate-50");
    expect(
      getByTestId(storyboard, "homepage-workflow-heading").className,
    ).not.toContain("leading-");
    expect(
      getByTestId(storyboard, "homepage-workflow-heading").className,
    ).not.toContain("text-balance");

    const markdownDemo = getByTestId(container, "rfm-format-demo");
    expect(
      storyboard.compareDocumentPosition(markdownDemo) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const scenes = [
      "Ask for a plan",
      "The agent works normally",
      "Roughdraft opens the plan",
      "Leave comments and suggestions",
      "Click I'm done",
      "The agent resumes",
    ];

    const sceneNodes = [
      ...storyboard.querySelectorAll('[data-testid="homepage-workflow-scene"]'),
    ];
    expect(sceneNodes).toHaveLength(scenes.length);

    const stickyVisual = getByTestId(
      storyboard,
      "homepage-workflow-sticky-visual",
    );
    expect(stickyVisual).not.toBeNull();
    expect(stickyVisual.getAttribute("data-mobile-workflow-visible")).toBe(
      "true",
    );
    expect(
      storyboard.querySelectorAll('[data-testid="homepage-workflow-terminal"]'),
    ).toHaveLength(1);
    expect(
      getByTestId(storyboard, "homepage-workflow-terminal").getAttribute(
        "data-homepage-workflow-terminal-stage",
      ),
    ).toBe("1");
    expect(
      getByTestId(storyboard, "homepage-workflow-agent-work").getAttribute(
        "data-agent-work-visible",
      ),
    ).toBe("false");
    expect(
      getByTestId(
        storyboard,
        "homepage-workflow-terminal-command",
      ).getAttribute("data-terminal-line-visible"),
    ).toBe("false");
    expect(
      getByTestId(storyboard, "homepage-workflow-terminal-input").getAttribute(
        "data-terminal-line-visible",
      ),
    ).toBe("false");
    expect(
      storyboard.querySelectorAll('[data-testid="homepage-workflow-popup"]'),
    ).toHaveLength(1);
    expect(
      getByTestId(storyboard, "homepage-workflow-popup-traffic-lights")
        .children,
    ).toHaveLength(3);
    expect(
      getByTestId(storyboard, "homepage-workflow-popup").getAttribute(
        "data-popup-visible",
      ),
    ).toBe("false");
    expect(
      getByTestId(storyboard, "homepage-workflow-popup").getAttribute(
        "aria-hidden",
      ),
    ).toBe("true");
    expect(stickyVisual.className).toContain("min-[900px]:sticky");
    expect(stickyVisual.className).toContain(
      "max-[899px]:data-[mobile-workflow-visible=false]:opacity-0",
    );
    expect(
      getByTestId(storyboard, "homepage-workflow-scene-list").className,
    ).toContain(
      "max-[899px]:pb-[calc(var(--homepage-workflow-dock-height)+var(--homepage-workflow-dock-bottom)+2rem)]",
    );
    expect(
      getByTestId(storyboard, "homepage-workflow-popup").className,
    ).toContain("absolute");
    expect(
      getByTestId(storyboard, "homepage-workflow-popup").className,
    ).toContain("data-[popup-visible=false]:opacity-0");
    expect(
      getByTestId(storyboard, "homepage-workflow-agent-work").className,
    ).toContain("data-[agent-work-visible=false]:max-h-0");
    expect(
      getByTestId(storyboard, "homepage-workflow-document-scale").parentElement
        ?.className,
    ).toContain(
      "max-[899px]:[--homepage-workflow-document-offset-y:clamp(1rem,5svh,2.75rem)]",
    );

    scenes.forEach((scene, index) => {
      expect(sceneNodes[index]?.textContent).toContain(String(index + 1));
      expect(sceneNodes[index]?.textContent).toContain(scene);
    });

    expect(storyboard.textContent).toContain(
      "Let's make the homepage more persuasive. Write a plan first.",
    );
    expect(storyboard.textContent).toContain(
      "I'll inspect the current homepage, draft a Markdown plan, and open it in Roughdraft for review before I code.",
    );
    expect(storyboard.textContent).toContain("Explored");
    expect(storyboard.textContent).toContain("Search");
    expect(storyboard.textContent).toContain(
      'rg "It\'s just Markdown" packages/app/src',
    );
    expect(storyboard.textContent).toContain("Read");
    expect(storyboard.textContent).toContain(
      "sed -n '1,220p' packages/app/src/App.tsx",
    );
    expect(storyboard.textContent).toContain("Write");
    expect(storyboard.textContent).toContain(
      ".context/homepage-conversion-plan.md",
    );
    expect(storyboard.textContent).toContain("Homepage Conversion Plan");
    expect(storyboard.textContent).toContain(
      'Move the workflow story above "It\'s just Markdown."',
    );
    expect(storyboard.textContent).toContain(
      "Show the agent pause, the review window, and the resume signal.",
    );
    expect(storyboard.textContent).toContain(
      "Keep the format section as proof that the review data is portable Markdown.",
    );
    expect(storyboard.textContent).toContain(
      "Review an agent's plan before it starts coding.",
    );
    expect(storyboard.textContent).not.toContain(
      'This should go above "It\'s just Markdown."',
    );
    expect(storyboard.textContent).not.toContain("Review complete");
    expect(storyboard.textContent).toContain("I read your comments.");
    expect(storyboard.textContent).toContain("Waiting for I'm done...");
  });

  it("shows user-authored review feedback before the agent responds after handoff", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });

    let activeStage = 4;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getWorkflowStageRect() {
        if (this.classList.contains("homepage-workflow-sticky-visual")) {
          return createDomRect({ top: 120, height: 360 });
        }

        if (this.classList.contains("homepage-workflow-intro")) {
          return createDomRect({ top: -120, height: 80 });
        }

        if (this.classList.contains("homepage-workflow-scene")) {
          const scenes = [
            ...document.querySelectorAll(
              '[data-testid="homepage-workflow-scene"]',
            ),
          ];
          const sceneIndex = scenes.indexOf(this);
          return createDomRect({
            top: sceneIndex < activeStage ? -12 : 320,
            height: 180,
          });
        }

        return createDomRect({ width: 640, height: 480 });
      },
    );

    await renderHomepage(root);

    const storyboard = getByTestId(container, "homepage-workflow-storyboard");
    expect(
      getByTestId(storyboard, "homepage-workflow-terminal").getAttribute(
        "data-homepage-workflow-terminal-stage",
      ),
    ).toBe("4");
    expect(storyboard.textContent).toContain(
      'This should go above "It\'s just Markdown."',
    );
    expect(storyboard.textContent).toContain("Nora");
    expect(storyboard.textContent).toContain(
      'Replace: "agent\'s plan" with "homepage plan"',
    );
    expect(
      getByTestId(storyboard, "homepage-workflow-review-rail").textContent,
    ).not.toContain("AI");
    expect(
      getByTestId(storyboard, "homepage-workflow-agent-resume").getAttribute(
        "data-terminal-line-visible",
      ),
    ).toBe("false");

    activeStage = 6;
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    expect(
      getByTestId(storyboard, "homepage-workflow-terminal").getAttribute(
        "data-homepage-workflow-terminal-stage",
      ),
    ).toBe("6");
    expect(storyboard.textContent).toContain("I read your comments.");
    expect(
      getByTestId(storyboard, "homepage-workflow-agent-resume").getAttribute(
        "data-terminal-line-visible",
      ),
    ).toBe("true");
    expect(storyboard.textContent).toContain(
      "I accepted your wording suggestion and moved the workflow story above the Markdown section.",
    );
  });

  it("advances the desktop workflow stage when a scene reaches the terminal top", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2200,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });

    let secondSceneTop = 141;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getWorkflowStageRect() {
        if (this.classList.contains("homepage-workflow-terminal")) {
          return createDomRect({ top: 140, height: 360 });
        }

        if (this.classList.contains("homepage-workflow-intro")) {
          return createDomRect({ top: -120, height: 80 });
        }

        if (this.classList.contains("homepage-workflow-scene")) {
          const scenes = [
            ...document.querySelectorAll(
              '[data-testid="homepage-workflow-scene"]',
            ),
          ];
          const sceneIndex = scenes.indexOf(this);

          return createDomRect({
            top: sceneIndex === 1 ? secondSceneTop : 320,
            height: 180,
          });
        }

        return createDomRect({ width: 640, height: 480 });
      },
    );

    await renderHomepage(root);

    const storyboard = getByTestId(container, "homepage-workflow-storyboard");
    expect(
      getByTestId(storyboard, "homepage-workflow-terminal").getAttribute(
        "data-homepage-workflow-terminal-stage",
      ),
    ).toBe("1");

    secondSceneTop = 140;
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    expect(
      getByTestId(storyboard, "homepage-workflow-terminal").getAttribute(
        "data-homepage-workflow-terminal-stage",
      ),
    ).toBe("2");
  });

  it("keeps the mobile workflow visual hidden until the heading has scrolled past", async () => {
    Object.defineProperty(document.documentElement, "scrollHeight", {
      configurable: true,
      value: 2000,
    });
    Object.defineProperty(window, "innerHeight", {
      configurable: true,
      value: 800,
    });
    vi.stubGlobal("matchMedia", () => ({
      matches: true,
      media: "(max-width: 899px)",
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    let workflowIntroBottom = 120;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function getWorkflowRect() {
        if (this.classList.contains("homepage-workflow-intro")) {
          return createDomRect({
            top: workflowIntroBottom - 80,
            height: 80,
          });
        }

        if (this.classList.contains("homepage-workflow-sticky-visual")) {
          return createDomRect({ top: 520, height: 240 });
        }

        return createDomRect({ width: 640, height: 480 });
      },
    );

    await renderHomepage(root);

    const stickyVisual = getByTestId(
      container,
      "homepage-workflow-sticky-visual",
    );
    expect(stickyVisual.getAttribute("data-mobile-workflow-visible")).toBe(
      "false",
    );

    workflowIntroBottom = 0;
    await act(async () => {
      window.dispatchEvent(new Event("scroll"));
      await Promise.resolve();
    });

    expect(stickyVisual.getAttribute("data-mobile-workflow-visible")).toBe(
      "true",
    );
  });

  it("renders the Roughdraft flavored Markdown spec page", async () => {
    await act(async () => {
      root.render(<RoughdraftFlavoredMarkdownPage />);
    });

    expect(container.textContent).toContain(
      "Markdown with review comments and suggested changes",
    );
    expect(container.textContent).toContain(
      "regular Markdown plus portable review markup",
    );
    expect(container.textContent).toContain("CriticMarkup");
    expect(container.textContent).toContain("Notion-flavored Markdown");
    expect(container.textContent).toContain("Official RFM spec");
    expect(container.textContent).toContain("Format contract");
    expect(container.textContent).toContain(
      "Review data lives where agents can inspect it",
    );
    expect(container.textContent).toContain("document-local");
    expect(
      container.querySelector('a[href="/spec/roughdraft-flavored-markdown.md"]')
        ?.textContent,
    ).toContain("Official RFM spec");
    expect(
      container.querySelector('a[href="https://criticmarkup.com/"]')
        ?.textContent,
    ).toContain("CriticMarkup");
    expect(
      container.querySelector(
        'a[href="https://developers.notion.com/guides/data-apis/enhanced-markdown"]',
      )?.textContent,
    ).toContain("Notion-flavored Markdown");
    expect(container.textContent).toContain("Threaded review");
    expect(container.textContent).toContain("Roughdraft extensions");
    expect(container.textContent).toContain("YAML metadata");
    expect(container.textContent).toContain("Substitution");
    expect(container.textContent).toContain("{~~old text~>new text~~}");
    expect(container.querySelector('a[href="/"]')?.textContent).toContain(
      "Back to Roughdraft",
    );
  });

  it("renders an in-memory live preview page", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    await act(async () => {
      root.render(
        <TooltipProvider>
          <PreviewPage />
        </TooltipProvider>,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("preview.md");
    expect(container.textContent).toContain("Live Preview");
    expect(container.textContent).toContain("This draft only lives in memory.");
    expect(container.textContent).toContain("Select this sentence");
    expect(container.textContent).not.toContain("I'm done");
    expect(container.textContent).not.toContain("Review ready");
    expect(container.textContent).not.toContain("Copy prompt");
    expect(setItem).not.toHaveBeenCalled();
  });
});
