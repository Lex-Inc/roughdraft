import { expect, test, type Page } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  seedDocumentWidth,
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

  test("keeps the document anchored when the review rail appears and disappears @smoke", async ({
    page,
  }) => {
    // The full-width layout anchors the document to the left gutter; this test
    // exercises that behavior, so pin the preference rather than the default.
    await seedDocumentWidth(page, "wide");

    const filePath = writeProjectFile(
      projectDir,
      "layout-shift.md",
      [
        "# Layout Shift",
        "",
        "This paragraph has target text to review.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const card = page.getByTestId("document-content-card");
    const header = page.getByTestId("document-page-header");
    const before = await card.boundingBox();
    const headerBefore = await header.boundingBox();
    if (!before || !headerBefore) {
      throw new Error("Could not measure the document layout");
    }
    // The document and its toolbar share the same left edge.
    expect(Math.abs(headerBefore.x - before.x)).toBeLessThan(2);

    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").click();
    await page.getByTestId("comment-rail-c1-editor").waitFor();
    await settleLayout(page);

    const withRail = await card.boundingBox();
    const headerWithRail = await header.boundingBox();
    if (!withRail || !headerWithRail) {
      throw new Error("Could not measure the document layout with the rail");
    }
    // The document stays anchored to the same left gutter (no horizontal jump)
    // and simply narrows to make room for the review rail on the right.
    expect(Math.abs(withRail.x - before.x)).toBeLessThan(2);
    expect(Math.abs(headerWithRail.x - before.x)).toBeLessThan(2);
    expect(withRail.width).toBeLessThan(before.width - 100);

    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Clarify this phrase.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await page.getByTestId("comment-rail-c1-action-delete-thread").waitFor();
    await page.getByTestId("comment-rail-c1-action-delete-thread").click();
    await expect(page.getByTestId("comment-rail-c1-editor")).toHaveCount(0);
    await settleLayout(page);

    const afterRemove = await card.boundingBox();
    if (!afterRemove) {
      throw new Error("Could not measure the document layout after removal");
    }
    // Removing the rail restores the full-width document without shifting it.
    expect(Math.abs(afterRemove.x - before.x)).toBeLessThan(2);
    expect(Math.abs(afterRemove.width - before.width)).toBeLessThan(2);

    logE2eEvent("criticmarkup.layout-shift", {
      file: "layout-shift.md",
      widthWithRail: Math.round(withRail.width),
      widthWithoutRail: Math.round(before.width),
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

// Let the review-layout FLIP transition (and any comment UI mount) settle so
// geometry reads are stable before measuring.
async function settleLayout(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          setTimeout(() => requestAnimationFrame(() => resolve()), 300);
        });
      }),
  );
}
