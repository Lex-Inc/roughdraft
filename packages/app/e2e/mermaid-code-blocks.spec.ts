import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
  writeProjectFile,
} from "./helpers";

async function selectMermaidSourceText(
  page: import("@playwright/test").Page,
  text: string,
) {
  await richTextEditor(page).focus();
  await page.evaluate((targetText) => {
    const source = document.querySelector(
      '[data-testid="mermaid-source-panel"]',
    );
    if (!source) throw new Error("Could not find Mermaid source");

    const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();

    while (node) {
      const index = node.textContent?.indexOf(targetText) ?? -1;
      if (index >= 0) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + targetText.length);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        document.dispatchEvent(new Event("selectionchange", { bubbles: true }));
        return;
      }
      node = walker.nextNode();
    }

    throw new Error(`Could not find Mermaid source text "${targetText}"`);
  }, text);
}

test.describe("Mermaid and highlighted code blocks", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("mermaid-code");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("highlights TypeScript and TSX, renders Mermaid, and preserves no-op views", async ({
    page,
  }) => {
    const original = [
      "# Rendered code",
      "",
      "```typescript",
      "interface Config {",
      "  enabled: boolean;",
      "}",
      "```",
      "",
      "```tsx",
      "export const Badge = () => <span>Ready</span>;",
      "```",
      "",
      "```mermaid",
      "flowchart LR",
      '  START["Start"] --> REVIEW["Review step"]',
      "",
      '  REVIEW --> DONE["Done"]',
      "```",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "rendered-code.md", original);

    await openMarkdownFile(page, filePath);
    const typescriptBlock = page
      .getByTestId("code-block")
      .filter({ hasText: "interface Config" });
    const tsxBlock = page
      .getByTestId("code-block")
      .filter({ hasText: "export const Badge" });
    const mermaidBlock = page.getByTestId("mermaid-code-block");

    await expect(typescriptBlock).toHaveAttribute(
      "data-code-language",
      "typescript",
    );
    await expect(tsxBlock).toHaveAttribute("data-code-language", "tsx");
    for (const block of [typescriptBlock, tsxBlock]) {
      await expect
        .poll(() =>
          block.evaluate((element) =>
            element.parentElement?.classList.contains("shiki"),
          ),
        )
        .toBe(true);
      await expect
        .poll(() =>
          block.evaluate(
            (element) =>
              Array.from(element.getElementsByTagName("span")).filter(
                (token) => token.style.color,
              ).length,
          ),
        )
        .toBeGreaterThan(0);
      await expect
        .poll(() =>
          block.evaluate((element) => ({
            outer: element.parentElement
              ? getComputedStyle(element.parentElement).backgroundColor
              : null,
            tokensAreTransparent: Array.from(
              element.getElementsByTagName("span"),
            ).every(
              (token) =>
                getComputedStyle(token).backgroundColor === "rgba(0, 0, 0, 0)",
            ),
          })),
        )
        .toEqual({
          outer: "rgba(0, 0, 0, 0)",
          tokensAreTransparent: true,
        });
    }
    const renderedDiagram = mermaidBlock.getByTestId("mermaid-rendered-svg");
    await expect(renderedDiagram).toBeVisible();
    await expect
      .poll(() =>
        mermaidBlock.evaluate((element) =>
          element.parentElement
            ? getComputedStyle(element.parentElement).backgroundColor
            : null,
        ),
      )
      .toBe("rgba(0, 0, 0, 0)");
    expect(
      await renderedDiagram.evaluate((element) => element.innerHTML),
    ).toContain("<svg");
    await expect(
      mermaidBlock.getByTestId("mermaid-view-diagram"),
    ).toHaveAttribute("aria-pressed", "true");

    expect(readProjectFile(projectDir, "rendered-code.md")).toBe(original);
    await mermaidBlock.getByTestId("mermaid-view-source").click();
    await expect(
      mermaidBlock.getByTestId("mermaid-source-panel"),
    ).toBeVisible();
    expect(readProjectFile(projectDir, "rendered-code.md")).toBe(original);
    await mermaidBlock.getByTestId("mermaid-view-diagram").click();
    await page.waitForTimeout(250);
    expect(readProjectFile(projectDir, "rendered-code.md")).toBe(original);
  });

  test("comments on Mermaid source and reopens it without newline corruption", async ({
    page,
  }) => {
    const original = [
      "# Comment a diagram",
      "",
      "```mermaid",
      "flowchart LR",
      '  START["Start"] --> REVIEW["Review step"]',
      "",
      '  REVIEW --> DONE["Done"]',
      "```",
      "",
    ].join("\n");
    const filePath = writeProjectFile(
      projectDir,
      "comment-diagram.md",
      original,
    );

    await openMarkdownFile(page, filePath);
    const mermaidBlock = page.getByTestId("mermaid-code-block");
    await expect(
      mermaidBlock.getByTestId("mermaid-rendered-svg"),
    ).toBeVisible();
    await mermaidBlock.getByTestId("mermaid-view-source").click();
    await selectMermaidSourceText(page, "Review step");
    await page.getByTestId("selection-menu-action-comment").click();
    await page
      .getByTestId("comment-rail-c1-editor")
      .fill("Keep this review step explicit.");
    await page.getByTestId("comment-rail-c1-action-save").click();

    await expect
      .poll(() => readProjectFile(projectDir, "comment-diagram.md"))
      .toContain(
        '{==Review step==}{>>Keep this review step explicit.<<}{id="c1"',
      );
    const saved = readProjectFile(projectDir, "comment-diagram.md");
    expect(saved).toContain(
      '  START["Start"] --> REVIEW["{==Review step==}{>>Keep this review step explicit.<<}',
    );
    expect(saved).toContain('\n\n  REVIEW --> DONE["Done"]\n```\n');

    await page.reload();
    await expect(
      page
        .getByTestId("mermaid-code-block")
        .getByTestId("mermaid-rendered-svg"),
    ).toBeVisible();
    await page.getByTestId("comment-thread-c1").click();
    await expect(
      page
        .getByTestId("mermaid-code-block")
        .getByTestId("mermaid-source-panel"),
    ).toBeVisible();
    expect(readProjectFile(projectDir, "comment-diagram.md")).toBe(saved);
  });

  test("keeps invalid Mermaid usable and re-renders valid diagrams for light and dark", async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: "light" });
    const filePath = writeProjectFile(
      projectDir,
      "themes-and-errors.md",
      [
        "# Themes and errors",
        "",
        "```mermaid",
        "flowchart LR",
        "  A --> B",
        "```",
        "",
        "```mermaid",
        "flowchart ???",
        "```",
        "",
        "The document remains editable.",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);
    const blocks = page.getByTestId("mermaid-code-block");
    const validBlock = blocks.nth(0);
    const invalidBlock = blocks.nth(1);
    const validSvg = validBlock.getByTestId("mermaid-rendered-svg");

    await expect(validSvg).toBeVisible();
    const lightSvg = await validSvg.evaluate((element) => element.innerHTML);
    expect(lightSvg).toContain("<svg");
    const lightBox = await validSvg.boundingBox();
    expect(lightBox?.width).toBeGreaterThan(40);
    expect(lightBox?.height).toBeGreaterThan(20);

    await expect(
      invalidBlock.getByTestId("mermaid-render-error"),
    ).toContainText("Check the Mermaid syntax below");
    await expect(
      invalidBlock.getByTestId("mermaid-source-panel"),
    ).toBeVisible();
    await expect(richTextEditor(page)).toHaveAttribute(
      "contenteditable",
      "true",
    );

    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() => validSvg.evaluate((element) => element.innerHTML))
      .not.toBe(lightSvg);
    const darkBox = await validSvg.boundingBox();
    expect(darkBox?.width).toBeGreaterThan(40);
    expect(darkBox?.height).toBeGreaterThan(20);
  });
});
