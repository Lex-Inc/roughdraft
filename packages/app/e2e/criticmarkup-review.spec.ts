import { expect, test, type Page } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  selectRichText,
  writeProjectFile,
} from "./helpers";

test.describe("CriticMarkup review flows", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("criticmarkup");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("renders a comment thread and saves a reply @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "comment.md",
      [
        "# Comment Review",
        "",
        'This paragraph has {==target text==}{>>Needs detail<<}{id="c1" by="user" at="2026-04-23T18:00:00.000Z"}.',
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("document-review-rail")).toContainText(
      "Needs detail",
    );

    await page
      .getByTestId("comment-rail-c1-action-reply")
      .evaluate((element) => {
        (element as HTMLButtonElement).click();
      });
    await page
      .getByTestId("comment-rail-c2-editor")
      .fill("Added context looks good.");
    await page
      .getByTestId("comment-rail-c2-action-save")
      .evaluate((element) => {
        (element as HTMLButtonElement).click();
      });

    await expect
      .poll(() => readProjectFile(projectDir, "comment.md"))
      .toContain("Added context looks good.");
    expect(readProjectFile(projectDir, "comment.md")).toContain('re="c1"');

    logE2eEvent("criticmarkup.reply-saved", {
      file: "comment.md",
    });
  });

  test("creates a new root comment and saves it to disk @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "new-comment.md",
      [
        "# New Comment",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").click();
    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Clarify this phrase.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await expect
      .poll(() => readProjectFile(projectDir, "new-comment.md"))
      .toMatch(
        /\{==target text==\}\{>>Clarify this phrase\.<<\}\{id="c1" by="user" at="[^"]+"\}/,
      );

    logE2eEvent("criticmarkup.root-comment-saved", {
      file: "new-comment.md",
    });
  });

  test("animates the document layout when the review rail appears and disappears @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "layout-animation.md",
      [
        "# Layout Animation",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").waitFor();

    const addSamplesPromise = sampleReviewLayoutAnimation(page);
    await page.getByTestId("selection-menu-action-comment").click();
    const addSamples = await addSamplesPromise;

    expect(hasAnimatedReviewLayout(addSamples)).toBe(true);
    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Clarify this phrase.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await page.getByTestId("comment-rail-c1-action-delete-thread").waitFor();
    const removeSamplesPromise = sampleReviewLayoutAnimation(page);
    await page.getByTestId("comment-rail-c1-action-delete-thread").click();
    const removeSamples = await removeSamplesPromise;

    expect(hasAnimatedReviewLayout(removeSamples)).toBe(true);

    logE2eEvent("criticmarkup.layout-animation", {
      file: "layout-animation.md",
    });
  });

  test("shows tooltips for selection menu formatting actions", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "selection-tooltips.md",
      [
        "# Selection Tooltips",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");

    await page.getByTestId("selection-menu-action-bold").hover();
    await expect(page.getByTestId("selection-menu-action-tooltip")).toHaveText(
      "Bold",
    );

    await expect(
      page.getByTestId("selection-menu-action-suggest-insertion"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("selection-menu-action-suggest-deletion"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("selection-menu-action-suggest-replacement"),
    ).toHaveCount(0);

    await page.getByTestId("selection-menu-action-comment").hover();
    await expect(page.getByTestId("selection-menu-action-tooltip")).toHaveCount(
      0,
    );
  });

  test("accepts and rejects suggested changes on disk @smoke", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "suggestions.md",
      [
        "# Suggestion Review",
        "",
        'Keep {++clear wording++}{id="s1" by="user" at="2026-04-23T18:00:00.000Z"} here.',
        "",
        'Remove {--drafty --}{id="s2" by="user" at="2026-04-23T18:01:00.000Z"}there.',
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await expect(page.locator('[data-critic-change-id="s1"]')).toBeVisible();

    await page.getByTestId("comment-rail-s1-action-accept").click();
    await expect
      .poll(() => readProjectFile(projectDir, "suggestions.md"))
      .toContain("Keep clear wording here.");

    await page.getByTestId("comment-rail-s2-action-reject").click();
    await expect
      .poll(() => readProjectFile(projectDir, "suggestions.md"))
      .toContain("Remove drafty there.");
    expect(readProjectFile(projectDir, "suggestions.md")).not.toContain("{++");
    expect(readProjectFile(projectDir, "suggestions.md")).not.toContain("{--");

    logE2eEvent("criticmarkup.suggestions-applied", {
      file: "suggestions.md",
    });
  });
});

type ReviewLayoutAnimationSample = {
  shellAnimating: boolean;
  headerAnimating: boolean;
  shellTranslateX: number;
  headerTranslateX: number;
};

async function sampleReviewLayoutAnimation(page: Page) {
  return page.evaluate(async () => {
    const readTranslateX = (element: Element | null) => {
      if (!(element instanceof HTMLElement)) return 0;
      const transform = getComputedStyle(element).transform;
      if (transform === "none") return 0;
      return new DOMMatrixReadOnly(transform).m41;
    };
    const samples: ReviewLayoutAnimationSample[] = [];
    const start = performance.now();

    while (performance.now() - start < 500) {
      const shell = document.querySelector(
        '[data-testid="document-page-shell"]',
      );
      const header = document.querySelector(
        '[data-testid="document-page-header"]',
      );
      samples.push({
        shellAnimating:
          shell instanceof HTMLElement &&
          shell.classList.contains("review-layout-grid--animating"),
        headerAnimating:
          header instanceof HTMLElement &&
          header.classList.contains("review-layout-grid--animating"),
        shellTranslateX: readTranslateX(shell),
        headerTranslateX: readTranslateX(header),
      });
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }

    return samples;
  });
}

function hasAnimatedReviewLayout(samples: ReviewLayoutAnimationSample[]) {
  return samples.some(
    (sample) =>
      sample.shellAnimating &&
      sample.headerAnimating &&
      Math.abs(sample.shellTranslateX) > 1 &&
      Math.abs(sample.headerTranslateX) > 1,
  );
}
