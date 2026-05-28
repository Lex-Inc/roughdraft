// TODO(phase-5): when `@roughdraft/rfh` ships, move these helpers there and
// stop borrowing `RfmReviewIndex` / `RfmValidationResult` literal-typed
// "roughdraft-flavored-markdown" labels. The literals are wrong for HTML but
// satisfy the FormatAdapter contract until shared types move to
// @roughdraft/review-types.

import { parseHTML } from "linkedom";
import type {
  AppendRoughdraftReplyOptions,
  MarkRoughdraftResolvedOptions,
  RfmDiagnostic,
  RfmReviewIndex,
  RfmReviewItem,
  RfmValidationResult,
} from "@roughdraft/rfm";

type AnyElement = Element;

function parse(html: string): { document: Document } {
  return parseHTML(html) as unknown as { document: Document };
}

function emptyDiagnostic(
  severity: "error" | "warning",
  code: string,
  message: string,
): RfmDiagnostic {
  return { severity, code, message, offset: 0, line: 0, column: 0 };
}

export function validateHtmlReview(html: string): RfmValidationResult {
  const { document } = parse(html);
  const diagnostics: RfmDiagnostic[] = [];

  const ids = new Map<string, number>();
  const elementsWithId = document.querySelectorAll("[data-rd-id]");
  for (const el of Array.from(elementsWithId)) {
    const id = el.getAttribute("data-rd-id");
    if (!id) continue;
    ids.set(id, (ids.get(id) ?? 0) + 1);
  }
  for (const [id, count] of ids) {
    if (count > 1) {
      diagnostics.push(
        emptyDiagnostic(
          "error",
          "duplicate-id",
          `data-rd-id "${id}" appears ${count} times`,
        ),
      );
    }
  }

  const elementsWithRe = document.querySelectorAll("[data-rd-re]");
  for (const el of Array.from(elementsWithRe)) {
    const re = el.getAttribute("data-rd-re");
    if (!re) continue;
    if (!ids.has(re)) {
      diagnostics.push(
        emptyDiagnostic(
          "error",
          "dangling-reference",
          `data-rd-re "${re}" does not match any data-rd-id`,
        ),
      );
    }
  }

  const pairCounts = new Map<string, number>();
  const elementsWithPair = document.querySelectorAll("[data-rd-pair]");
  for (const el of Array.from(elementsWithPair)) {
    const pair = el.getAttribute("data-rd-pair");
    if (!pair) continue;
    pairCounts.set(pair, (pairCounts.get(pair) ?? 0) + 1);
  }
  for (const [pair, count] of pairCounts) {
    if (count !== 2) {
      diagnostics.push(
        emptyDiagnostic(
          "error",
          "incomplete-pair",
          `data-rd-pair "${pair}" should have exactly 2 elements, found ${count}`,
        ),
      );
    }
  }

  const errors = diagnostics.filter((d) => d.severity === "error");
  const warnings = diagnostics.filter((d) => d.severity === "warning");

  const commentSpans = document.querySelectorAll("[data-rd-comment]");
  const suggestionEls = document.querySelectorAll(
    "ins[data-rd-id], del[data-rd-id]",
  );

  return {
    format: "roughdraft-flavored-markdown",
    version: "0.1",
    ok: errors.length === 0,
    diagnostics,
    errors,
    warnings,
    summary: {
      comments: commentSpans.length,
      suggestions: suggestionEls.length,
      legacyMetadata: 0,
    },
  };
}

function reviewItemFromElement(el: AnyElement): RfmReviewItem | null {
  const id = el.getAttribute("data-rd-id");
  if (!id) return null;
  const author = el.getAttribute("data-rd-by");
  const createdAt = el.getAttribute("data-rd-at");
  const re = el.getAttribute("data-rd-re");
  const status = el.getAttribute("data-rd-status");
  const text = el.textContent ?? "";
  const tag = el.tagName.toLowerCase();
  const pair = el.getAttribute("data-rd-pair");

  let kind: RfmReviewItem["kind"] = "comment";
  let suggestionKind: RfmReviewItem["suggestionKind"];

  if (el.hasAttribute("data-rd-comment")) {
    kind = re?.startsWith("c") ? "reply" : "comment";
  } else if (tag === "ins") {
    kind = "suggestion";
    suggestionKind = pair ? "substitution" : "addition";
  } else if (tag === "del") {
    kind = "suggestion";
    suggestionKind = pair ? "substitution" : "deletion";
  } else if (tag === "mark") {
    kind = "comment";
  }

  return {
    id,
    kind,
    ...(suggestionKind ? { suggestionKind } : {}),
    parentId: re ?? null,
    author: author ?? null,
    createdAt: createdAt ?? null,
    status: status ?? null,
    text,
    offset: 0,
    endOffset: 0,
    line: 0,
    column: 0,
  };
}

export function extractHtmlReviewIndex(html: string): RfmReviewIndex {
  const { document } = parse(html);
  const items: RfmReviewItem[] = [];
  const selectors =
    "mark[data-rd-id], ins[data-rd-id], del[data-rd-id], [data-rd-comment]";
  const elements = document.querySelectorAll(selectors);
  for (const el of Array.from(elements)) {
    const item = reviewItemFromElement(el);
    if (item) items.push(item);
  }

  const comments = items.filter((i) => i.kind === "comment").length;
  const replies = items.filter((i) => i.kind === "reply").length;
  const suggestions = items.filter((i) => i.kind === "suggestion").length;
  const unresolved = items.filter((i) => i.status !== "resolved").length;

  return {
    format: "roughdraft-flavored-markdown",
    version: "0.1",
    items,
    diagnostics: [],
    summary: { comments, replies, suggestions, unresolved },
  };
}

function nextCommentId(existing: ReadonlyArray<string>): string {
  let max = 0;
  for (const id of existing) {
    const match = id.match(/^c(\d+)$/);
    if (match) {
      const n = Number.parseInt(match[1], 10);
      if (n > max) max = n;
    }
  }
  return `c${max + 1}`;
}

export function appendHtmlReply(
  html: string,
  options: AppendRoughdraftReplyOptions,
): string {
  const { document } = parse(html);
  const existingIds = Array.from(
    document.querySelectorAll("[data-rd-id]"),
  ).flatMap((el) => {
    const id = el.getAttribute("data-rd-id");
    return id ? [id] : [];
  });

  const id = options.id ?? nextCommentId(existingIds);
  const at = options.at ?? new Date().toISOString();

  const span = document.createElement("span");
  span.setAttribute("data-rd-comment", "");
  span.setAttribute("hidden", "");
  span.setAttribute("data-rd-id", id);
  span.setAttribute("data-rd-re", options.parentId);
  if (options.author) span.setAttribute("data-rd-by", options.author);
  span.setAttribute("data-rd-at", at);
  span.textContent = options.message;

  document.body.appendChild(span);

  return `<!doctype html>${document.documentElement.outerHTML}`;
}

export function markHtmlResolved(
  html: string,
  options: MarkRoughdraftResolvedOptions,
): string {
  const { document } = parse(html);
  const target = document.querySelector(`[data-rd-id="${options.targetId}"]`);
  if (target) {
    target.setAttribute("data-rd-status", "resolved");
    if (options.summary) {
      target.setAttribute("data-rd-resolution", options.summary);
    }
  }
  return `<!doctype html>${document.documentElement.outerHTML}`;
}
