import fs from "node:fs";
import { expect, test } from "@playwright/test";
import {
  appendInCodeEditor,
  codeEditor,
  createMarkdownProject,
  documentSaveStatus,
  logE2eEvent,
  openMarkdownFile,
  readProjectFile,
  removeMarkdownProject,
  richTextEditor,
  selectRichText,
  writeProjectFile,
} from "./helpers";

test.describe("markdown round-trips", () => {
  let projectDir: string;

  test.beforeEach(() => {
    projectDir = createMarkdownProject("roundtrip");
  });

  test.afterEach(() => {
    removeMarkdownProject(projectDir);
  });

  test("toggles rich text and code mode without rewriting literal CriticMarkup @smoke", async ({
    page,
  }) => {
    const original = [
      "---",
      "title: Literal CriticMarkup",
      "---",
      "",
      "# Round Trip",
      "",
      "Inline code stays literal: `{==not a comment==}`.",
      "",
      "```md",
      "{>>not review feedback<<}",
      "{++not a suggestion++}",
      "```",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "roundtrip.md", original);

    await openMarkdownFile(page, filePath);
    await expect(page.getByTestId("rich-text-editor")).toContainText(
      "Round Trip",
    );

    await page.getByTestId("document-editor-view-toggle").click();
    await expect(codeEditor(page)).toContainText("{>>not review feedback<<}");

    await page.getByTestId("document-editor-view-toggle").click();
    await expect(page.getByTestId("rich-text-editor")).toContainText(
      "Round Trip",
    );
    expect(readProjectFile(projectDir, "roundtrip.md")).toBe(original);

    logE2eEvent("markdown-roundtrip.toggle-preserved", {
      file: "roundtrip.md",
    });
  });

  test("saves code-mode edits to disk while preserving fenced CriticMarkup examples @smoke", async ({
    page,
  }) => {
    const initial = [
      "# Code Save",
      "",
      "```md",
      "{==literal==}{>>example<<}",
      "```",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "code-save.md", initial);

    await openMarkdownFile(page, filePath, "code");
    await appendInCodeEditor(page, "\nSaved from Playwright.\n");

    await expect
      .poll(() => readProjectFile(projectDir, "code-save.md"))
      .toContain("Saved from Playwright.");
    expect(readProjectFile(projectDir, "code-save.md")).toContain(
      "{==literal==}{>>example<<}",
    );

    logE2eEvent("markdown-roundtrip.code-save", {
      size: fs.statSync(filePath).size,
    });
  });

  test("initial open shows persistent saved status", async ({ page }) => {
    const filePath = writeProjectFile(
      projectDir,
      "initial-saved.md",
      "# Initial Saved\n\nBody.\n",
    );

    await openMarkdownFile(page, filePath);

    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    logE2eEvent("markdown-roundtrip.initial-saved", {
      file: "initial-saved.md",
    });
  });

  test("manual save shortcut flushes code-mode edits to disk @smoke", async ({
    page,
  }) => {
    const initial = ["# Manual Save", "", "Initial body.", ""].join("\n");
    const filePath = writeProjectFile(projectDir, "manual-save.md", initial);

    await openMarkdownFile(page, filePath, "code");
    await appendInCodeEditor(page, "\nSaved by shortcut.\n");

    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );

    await expect
      .poll(() => readProjectFile(projectDir, "manual-save.md"))
      .toContain("Saved by shortcut.");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    logE2eEvent("markdown-roundtrip.manual-save-shortcut", {
      file: "manual-save.md",
      size: fs.statSync(filePath).size,
    });
  });

  test("manual save shortcut flushes rich-text edits to disk", async ({
    page,
  }) => {
    const initial = ["# Rich Save", "", "Initial body.", ""].join("\n");
    const filePath = writeProjectFile(projectDir, "rich-save.md", initial);

    await openMarkdownFile(page, filePath, "rich-text");
    const editor = richTextEditor(page);
    await expect(editor).toBeVisible();
    await editor.click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.type(" Saved by shortcut.");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );

    await expect
      .poll(() => readProjectFile(projectDir, "rich-save.md"))
      .toContain("Saved by shortcut.");
    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );

    logE2eEvent("markdown-roundtrip.rich-manual-save", {
      file: "rich-save.md",
      size: fs.statSync(filePath).size,
    });
  });

  test("rich-text save keeps task-list checkboxes on single lines", async ({
    page,
  }) => {
    const initial = [
      "# Task List",
      "",
      "Intro.",
      "",
      "- [ ] Claude reviewed",
      "- [x] Codex reviewed",
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "task-list.md", initial);

    await openMarkdownFile(page, filePath, "rich-text");
    const editor = richTextEditor(page);
    await expect(editor).toContainText("Claude reviewed");
    await editor.click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.type("Saved.");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );

    await expect
      .poll(() => readProjectFile(projectDir, "task-list.md"))
      .toContain("Saved.");
    const saved = readProjectFile(projectDir, "task-list.md");
    expect(saved).toContain("- [ ] Claude reviewed");
    expect(saved).toContain("- [x] Codex reviewed");
    expect(saved).not.toContain("- [ ] \n");
    expect(saved).not.toContain("- [x] \n");

    logE2eEvent("markdown-roundtrip.task-list-save", {
      file: "task-list.md",
      size: fs.statSync(filePath).size,
    });
  });

  test("rich-text comments avoid unrelated Markdown formatting churn", async ({
    page,
  }) => {
    const initial = [
      "# Formatting Churn",
      "",
      "This paragraph has target text for review.",
      "",
      "---",
      "",
      "| Key | Value |",
      "|---|---|",
      "| alpha | beta |",
      "",
      "> First quoted line",
      "> Second quoted line",
      "",
    ].join("\n");
    writeProjectFile(projectDir, "formatting-churn.md", initial);

    await openMarkdownFile(
      page,
      `${projectDir}/formatting-churn.md`,
      "rich-text",
    );
    await selectRichText(page, "target text");
    await page.getByTestId("selection-menu-action-comment").click();
    await page.getByTestId("comment-rail-c1-editor").fill("Check this text.");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );

    await expect
      .poll(() => readProjectFile(projectDir, "formatting-churn.md"))
      .toContain("Check this text.");
    const saved = readProjectFile(projectDir, "formatting-churn.md");
    expect(saved).toContain("---\n\n| Key | Value |\n|---|---|");
    expect(saved).toContain("> First quoted line\n> Second quoted line");
    expect(saved).not.toContain("* * *");
    expect(saved).not.toContain("| --- | --- |");
    expect(saved).not.toContain("> First quoted line\n>\n> Second quoted line");

    logE2eEvent("markdown-roundtrip.formatting-churn-avoided", {
      file: "formatting-churn.md",
      size: fs.statSync(`${projectDir}/formatting-churn.md`).size,
    });
  });

  test("rich-text save preserves final YAML review metadata", async ({
    page,
  }) => {
    const initial = [
      "# Roughdraft Endmatter Test",
      "",
      "Plain prose. No body markup.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-04-28T12:00:00.000Z"',
      "",
    ].join("\n");
    const filePath = writeProjectFile(projectDir, "yaml-endmatter.md", initial);

    await openMarkdownFile(page, filePath, "rich-text");
    const editor = richTextEditor(page);
    await expect(editor).toContainText("Plain prose");
    await expect(editor).not.toContainText("comments:");
    await editor.click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+End" : "Control+End",
    );
    await page.keyboard.type(" Edited.");
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );

    await expect
      .poll(() => readProjectFile(projectDir, "yaml-endmatter.md"))
      .toContain("Edited.");
    const saved = readProjectFile(projectDir, "yaml-endmatter.md");
    expect(saved).toContain("---\ncomments:");
    expect(saved).toContain("c1:");
    expect(saved).toContain("2026-04-28T12:00:00.000Z");
    expect(saved).not.toContain("* * *");
    expect(saved).not.toContain("comments: c1:");

    logE2eEvent("markdown-roundtrip.yaml-endmatter-save", {
      file: "yaml-endmatter.md",
      size: fs.statSync(filePath).size,
    });
  });

  test("rich-text renders table rows with multiple inline code cells", async ({
    page,
  }) => {
    const initial = [
      "# Inline Code Table",
      "",
      "| key | val |",
      "| --- | --- |",
      "| `a` | `1` |",
      "",
    ].join("\n");
    const filePath = writeProjectFile(
      projectDir,
      "inline-code-table.md",
      initial,
    );

    await openMarkdownFile(page, filePath, "rich-text");
    const editor = richTextEditor(page);
    const tableState = await editor.evaluate((element) => {
      const tables = Array.from(element.getElementsByTagName("table"));
      const table = tables[0];
      const rect = table?.getBoundingClientRect();
      const inlineCodeTexts = Array.from(
        table?.getElementsByTagName("td") ?? [],
      ).flatMap((cell) =>
        Array.from(cell.getElementsByTagName("code")).map(
          (code) => code.textContent ?? "",
        ),
      );
      const rawBlockCount = Array.from(
        element.getElementsByTagName("*"),
      ).filter((node) => node.hasAttribute("data-markdown-raw-block")).length;

      return {
        tableCount: tables.length,
        tableVisible: Boolean(rect && rect.width > 0 && rect.height > 0),
        inlineCodeTexts,
        rawBlockCount,
      };
    });

    expect(tableState).toEqual({
      tableCount: 1,
      tableVisible: true,
      inlineCodeTexts: ["a", "1"],
      rawBlockCount: 0,
    });

    await editor.click();
    await page.keyboard.press(
      process.platform === "darwin" ? "Meta+S" : "Control+S",
    );

    await expect(documentSaveStatus(page)).toHaveAttribute(
      "aria-label",
      "Saved",
    );
    expect(readProjectFile(projectDir, "inline-code-table.md")).toContain(
      "| `a` | `1` |",
    );

    logE2eEvent("markdown-roundtrip.inline-code-table-rendered", {
      file: "inline-code-table.md",
      size: fs.statSync(filePath).size,
    });
  });

  test("save shortcut prevents browser default in rich-text and code modes", async ({
    page,
  }) => {
    const filePath = writeProjectFile(
      projectDir,
      "prevent-default.md",
      "# Prevent Default\n\nBody.\n",
    );

    for (const editorMode of ["rich-text", "code"] as const) {
      await openMarkdownFile(page, filePath, editorMode);

      if (editorMode === "code") {
        await codeEditor(page).click();
      } else {
        await richTextEditor(page).click();
      }

      const events = await page.evaluate(() =>
        [
          { metaKey: true, ctrlKey: false },
          { metaKey: false, ctrlKey: true },
        ].map((init) => {
          const event = new KeyboardEvent("keydown", {
            key: "s",
            ...init,
            bubbles: true,
            cancelable: true,
          });
          window.dispatchEvent(event);
          return {
            defaultPrevented: event.defaultPrevented,
            metaKey: event.metaKey,
            ctrlKey: event.ctrlKey,
          };
        }),
      );

      expect(events).toEqual([
        { defaultPrevented: true, metaKey: true, ctrlKey: false },
        { defaultPrevented: true, metaKey: false, ctrlKey: true },
      ]);
      await expect(documentSaveStatus(page)).toHaveAttribute(
        "aria-label",
        "Saved",
      );
    }

    logE2eEvent("markdown-roundtrip.save-default-prevented", {
      file: "prevent-default.md",
    });
  });
});
