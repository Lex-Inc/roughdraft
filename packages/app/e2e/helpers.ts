import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export function createMarkdownProject(label: string) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `roughdraft-${label}-`));
}

export function removeMarkdownProject(projectDir: string) {
  fs.rmSync(projectDir, { recursive: true, force: true });
}

export function writeProjectFile(
  projectDir: string,
  relativePath: string,
  content: string | Buffer,
) {
  const absolutePath = path.join(projectDir, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, content);
  return absolutePath;
}

export function readProjectFile(projectDir: string, relativePath: string) {
  return fs.readFileSync(path.join(projectDir, relativePath), "utf8");
}

export async function openMarkdownFile(
  page: Page,
  absolutePath: string,
  editor?: "rich-text" | "code",
) {
  const params = new URLSearchParams({ path: absolutePath });
  if (editor) params.set("editor", editor);

  await page.goto(`/?${params.toString()}`);
}

/**
 * Seed the persisted document-width preference before the app loads, so a test
 * can pin the layout mode it exercises instead of depending on the default.
 * Runs on every navigation in the context, so avoid it when asserting that a
 * toggled preference persists across a reload.
 */
export async function seedDocumentWidth(
  page: Page,
  width: "comfortable" | "wide",
) {
  await page.addInitScript((value) => {
    window.localStorage.setItem("roughdraft:document-width", value);
  }, width);
}

export function codeEditor(page: Page) {
  return page.getByTestId("markdown-code-editor").locator(".cm-content");
}

export function richTextEditor(page: Page) {
  return page.getByTestId("rich-text-editor").locator(".ProseMirror");
}

export function documentSaveStatus(page: Page) {
  return page.getByTestId("document-save-status");
}

export function fileConflictNotice(page: Page) {
  return page.getByTestId("file-conflict-notice");
}

export async function appendInCodeEditor(page: Page, text: string) {
  const editor = codeEditor(page);
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+End" : "Control+End",
  );
  await page.keyboard.type(text);
}

export async function selectRichText(page: Page, text: string) {
  await richTextEditor(page).focus();
  await page.evaluate((targetText) => {
    const editor = document.querySelector(".ProseMirror");
    if (!editor) {
      throw new Error("Could not find rich-text editor");
    }

    const walker = document.createTreeWalker(editor, NodeFilter.SHOW_TEXT);
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

    throw new Error(`Could not find text "${targetText}"`);
  }, text);
}

export function logE2eEvent(event: string, data: Record<string, unknown> = {}) {
  const file = process.env.THOUGHTFUL_SLOG_FILE;
  if (!file) return;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(
    file,
    `${JSON.stringify({
      ts: new Date().toISOString(),
      runId: process.env.THOUGHTFUL_SLOG_RUN_ID ?? "manual",
      source: "packages/app/e2e",
      event,
      data,
    })}\n`,
  );
}
