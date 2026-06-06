import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  richTextEditor,
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

    const editor = richTextEditor(page);
    await expect(editor).toContainText("const value = 1;");

    await expect
      .poll(async () => (await editor.innerHTML()).includes("hljs-"))
      .toBe(true);

    logE2eEvent("appearance.syntax-highlighted", {
      projectDir,
      file: "code.md",
    });
  });
});
