import { expect, test } from "@playwright/test";
import {
  createMarkdownProject,
  logE2eEvent,
  openMarkdownFile,
  removeMarkdownProject,
  writeProjectFile,
} from "./helpers";

test.describe("mermaid diagram rendering", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("mermaid");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("paints a mermaid fence as an inline SVG diagram", async ({ page }) => {
    const filePath = writeProjectFile(
      projectDir,
      "diagram.md",
      [
        "# Mermaid",
        "",
        "```mermaid",
        "graph TD",
        "  A[Start] --> B[End]",
        "```",
        "",
        "```ts",
        "const value = 1;",
        "```",
        "",
      ].join("\n"),
    );

    await openMarkdownFile(page, filePath);

    const editor = page.locator(".ProseMirror");
    await expect(editor).toContainText("Mermaid");

    // The mermaid fence renders to an inline SVG (not a code block). Mermaid
    // loads lazily and renders asynchronously, so poll until the SVG appears.
    await expect
      .poll(async () => (await editor.innerHTML()).includes("<svg"), {
        timeout: 15_000,
      })
      .toBe(true);

    const html = await editor.innerHTML();
    // The rendered diagram reflects the source node labels.
    expect(html).toContain("Start");
    expect(html).toContain("End");
    // A non-mermaid fence stays a code block, not a diagram.
    expect(html).toContain("const value = 1;");
    expect(html).toContain("<pre");

    logE2eEvent("mermaid.rendered", { projectDir, file: "diagram.md" });
  });
});
