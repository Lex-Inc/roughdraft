import { expect, type Page, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  selectRichText,
  writeProjectFile,
} from "./helpers";

/**
 * Below the 1100px review-rail breakpoint the anchored rail is hidden and the
 * comment composer renders in a dock. The reviewer must keep their place in the
 * document when a comment is added: the composer is what moves, not the page.
 */
const NARROW_VIEWPORT = { width: 1000, height: 800 };

function longDocument(targetParagraph: string) {
  const lines = ["# Narrow Composer", ""];

  for (let section = 1; section <= 12; section += 1) {
    lines.push(`## Section ${section}`, "");
    for (let paragraph = 1; paragraph <= 3; paragraph += 1) {
      lines.push(
        `Section ${section} paragraph ${paragraph} exists to make this document tall enough to scroll.`,
        "",
      );
    }
  }

  lines.push(targetParagraph, "");

  return lines.join("\n");
}

async function scrollToEndOfDocument(page: Page) {
  await page.getByTestId("document-scroll-container").evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
}

test.describe("narrow-viewport comment composer", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("narrow-composer");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("keeps the reviewer's scroll position when a comment is added @smoke", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW_VIEWPORT);

    const filePath = writeProjectFile(
      projectDir,
      "narrow-composer.md",
      longDocument("This closing paragraph has target text to review."),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await scrollToEndOfDocument(page);
    await page.getByTestId("selection-menu-action-comment").waitFor();

    const scrollContainer = page.getByTestId("document-scroll-container");
    const scrollTopBeforeComment = await scrollContainer.evaluate(
      (element) => element.scrollTop,
    );
    expect(scrollTopBeforeComment).toBeGreaterThan(0);

    await page.getByTestId("selection-menu-action-comment").click();
    await expect(page.getByTestId("comment-banner-c1-editor")).toBeVisible();

    const scrollTopAfterComment = await scrollContainer.evaluate(
      (element) => element.scrollTop,
    );

    // The document must not be yanked back to the top.
    expect(scrollTopAfterComment).toBeGreaterThan(0);

    logE2eEvent("narrow-composer.scroll-preserved", {
      scrollTopBeforeComment,
      scrollTopAfterComment,
    });
  });

  test("docks the composer over the document without covering the commented text @smoke", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW_VIEWPORT);

    const filePath = writeProjectFile(
      projectDir,
      "narrow-dock.md",
      longDocument("This closing paragraph has target text to review."),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await scrollToEndOfDocument(page);
    await page.getByTestId("selection-menu-action-comment").click();
    await expect(page.getByTestId("comment-banner-c1-editor")).toBeVisible();

    const dock = page.getByTestId("document-comment-dock");
    await expect(dock).toBeVisible();
    expect(
      await dock.evaluate((element) => getComputedStyle(element).position),
    ).toBe("fixed");

    const dockBox = await dock.boundingBox();
    const anchorBox = await page
      .locator(".comment-anchor[data-comment-ids]")
      .first()
      .boundingBox();

    if (!dockBox || !anchorBox) {
      throw new Error(
        "Expected the dock and the comment anchor to be laid out",
      );
    }

    // The dock sits at the bottom of the viewport...
    expect(dockBox.y + dockBox.height).toBeLessThanOrEqual(
      NARROW_VIEWPORT.height + 1,
    );
    expect(dockBox.y).toBeGreaterThan(NARROW_VIEWPORT.height / 2);

    // ...and the text being commented on stays visible above it.
    expect(anchorBox.y).toBeGreaterThanOrEqual(0);
    expect(anchorBox.y + anchorBox.height).toBeLessThanOrEqual(dockBox.y + 1);

    logE2eEvent("narrow-composer.dock-clears-anchor", {
      dockTop: dockBox.y,
      anchorBottom: anchorBox.y + anchorBox.height,
    });
  });

  test("nudges the document only far enough to clear the dock @smoke", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW_VIEWPORT);

    const filePath = writeProjectFile(
      projectDir,
      "narrow-nudge.md",
      longDocument("This closing paragraph has target text to review."),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");

    const scrollContainer = page.getByTestId("document-scroll-container");
    // Park the highlight low enough that the dock will land on top of it.
    await scrollContainer.evaluate((element) => {
      const selectionTop = window
        .getSelection()
        ?.getRangeAt(0)
        .getBoundingClientRect().top;
      if (selectionTop === undefined) throw new Error("Expected a selection");
      element.scrollTop += selectionTop - (window.innerHeight - 90);
    });
    const scrollTopBeforeComment = await scrollContainer.evaluate(
      (element) => element.scrollTop,
    );

    await page.getByTestId("selection-menu-action-comment").click();
    await expect(page.getByTestId("comment-banner-c1-editor")).toBeVisible();

    const dockBox = await page
      .getByTestId("document-comment-dock")
      .boundingBox();
    const anchorBox = await page
      .locator(".comment-anchor[data-comment-ids]")
      .first()
      .boundingBox();
    const scrollTopAfterComment = await scrollContainer.evaluate(
      (element) => element.scrollTop,
    );

    if (!dockBox || !anchorBox) {
      throw new Error(
        "Expected the dock and the comment anchor to be laid out",
      );
    }

    // It moved...
    expect(scrollTopAfterComment).toBeGreaterThan(scrollTopBeforeComment);
    // ...by no more than the dock it had to clear...
    expect(scrollTopAfterComment - scrollTopBeforeComment).toBeLessThanOrEqual(
      dockBox.height + 32,
    );
    // ...and the highlight ended up visible.
    expect(anchorBox.y + anchorBox.height).toBeLessThanOrEqual(dockBox.y + 1);
  });

  test("lines the docked composer up with the document column @smoke", async ({
    page,
  }) => {
    await page.setViewportSize(NARROW_VIEWPORT);

    const filePath = writeProjectFile(
      projectDir,
      "narrow-alignment.md",
      longDocument("This closing paragraph has target text to review."),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").click();

    const panelBox = await page
      .getByTestId("document-comment-dock-panel")
      .boundingBox();
    const documentBox = await page
      .getByTestId("document-content-card")
      .boundingBox();

    if (!panelBox || !documentBox) {
      throw new Error(
        "Expected the dock panel and the document to be laid out",
      );
    }

    expect(Math.abs(panelBox.x - documentBox.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(panelBox.width - documentBox.width)).toBeLessThanOrEqual(1);
  });

  test("leaves the anchored rail in place above the breakpoint @smoke", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 });

    const filePath = writeProjectFile(
      projectDir,
      "wide-rail.md",
      longDocument("This closing paragraph has target text to review."),
    );

    await openMarkdownFile(page, filePath);
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").click();

    await expect(page.getByTestId("comment-rail-c1-editor")).toBeVisible();
    await expect(page.getByTestId("document-comment-dock")).toBeHidden();
  });
});
