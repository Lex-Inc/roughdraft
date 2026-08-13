import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

/**
 * The rendered document should cover most of the available width, leaving a
 * ~5% gutter on the left and right, so wide content (e.g. ASCII diagrams in
 * fenced code blocks) has room instead of being squeezed into a fixed narrow
 * column. See the widened `.review-layout-grid` document column.
 */
test.describe("document content width", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("content-width");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("fills ~90% of the available width with ~5% side gutters @smoke", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });

    const filePath = writeProjectFile(
      projectDir,
      "diagram.md",
      [
        "# Wide diagram",
        "",
        "A document with a wide ASCII diagram that needs room.",
        "",
        "```text",
        "+----------+      +----------+      +----------+      +-----------+",
        "|  client  | ---> |  gateway | ---> |  service | ---> |  database |",
        "+----------+      +----------+      +----------+      +-----------+",
        "```",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    await expect(richTextEditor(page)).toContainText("Wide diagram");

    const scrollRegion = page.getByTestId("document-scroll-region");
    const contentCard = page.getByTestId("document-content-card");

    const region = await scrollRegion.boundingBox();
    const card = await contentCard.boundingBox();
    if (!region || !card) {
      throw new Error("Could not measure content layout");
    }

    const leftGutter = card.x - region.x;
    const rightGutter = region.x + region.width - (card.x + card.width);
    const widthRatio = card.width / region.width;

    // Content is far wider than the old fixed 46.5rem (~744px) column.
    expect(card.width).toBeGreaterThan(1100);

    // Content covers most of the available width, but is not full-bleed.
    expect(widthRatio).toBeGreaterThan(0.86);
    expect(widthRatio).toBeLessThan(0.94);

    // Roughly 5% gutter on each side, and the gutters are symmetric
    // (allowing for a possible vertical scrollbar shaving the right edge).
    expect(leftGutter).toBeGreaterThan(region.width * 0.035);
    expect(leftGutter).toBeLessThan(region.width * 0.065);
    expect(rightGutter).toBeGreaterThan(region.width * 0.025);
    expect(rightGutter).toBeLessThan(region.width * 0.065);
    expect(Math.abs(leftGutter - rightGutter)).toBeLessThan(24);

    logE2eEvent("content-width.wide-column", {
      file: "diagram.md",
      regionWidth: Math.round(region.width),
      cardWidth: Math.round(card.width),
      leftGutter: Math.round(leftGutter),
      rightGutter: Math.round(rightGutter),
      widthRatio: Number(widthRatio.toFixed(3)),
    });
  });
});
