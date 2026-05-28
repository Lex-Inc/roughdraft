import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

test.describe("appearance customization", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("appearance");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("syntax-highlights fenced code blocks", async ({ page }) => {
    const filePath = writeProjectFile(
      projectDir,
      "code.md",
      ["# Code", "", "```ts", "const value = 1;", "```", ""].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("const value = 1;");

    // lowlight wraps tokens in hljs-* spans once the code block highlights.
    await expect
      .poll(async () => (await editor.innerHTML()).includes("hljs-"))
      .toBe(true);

    logE2eEvent("appearance.highlighted", { projectDir, file: "code.md" });
  });

  test("changes the editor font size from the settings dialog", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "doc.md",
      "# Doc\n\nBody text.\n",
    );

    await openMarkdownFile(page, filePath);

    // The editor element carries both the .tiptap and .ProseMirror classes.
    const readEditorFontSize = () =>
      page.evaluate(() => {
        const el = document.querySelector(".ProseMirror");
        return el ? Number.parseFloat(getComputedStyle(el).fontSize) : 0;
      });

    await expect(page.locator(".ProseMirror")).toContainText("Body text.");
    const initialSize = await readEditorFontSize();

    await page.getByTestId("settings-trigger").click();
    await expect(page.getByTestId("settings-dialog")).toBeVisible();

    const sizeValue = page.getByTestId("settings-font-size-value");
    await expect(sizeValue).toHaveText("16px");

    await page.getByTestId("settings-font-size-increase").click();
    await expect(sizeValue).toHaveText("17px");

    // The actual rendered editor font size must change, not just the label.
    await expect.poll(readEditorFontSize).toBeGreaterThan(initialSize);

    logE2eEvent("appearance.font-size-changed", { projectDir, file: "doc.md" });
  });
});
