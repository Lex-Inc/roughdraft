import { generateJSON, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { parseHTML } from "linkedom";
import type { CriticComment } from "../critic-markup";
import {
  appendHtmlReply,
  extractHtmlReviewIndex,
  markHtmlResolved,
  validateHtmlReview,
} from "./html-review";
import type {
  EditorState,
  FormatAdapter,
  ParseOptions,
  ReplyOptions,
  ResolveOptions,
  ReviewIndex,
  ValidationResult,
} from "./format-adapter";

const extensions = [StarterKit];

interface HtmlPreambleData {
  preamble: string;
  postamble: string;
  rawBody: string;
}

function splitHtmlDocument(raw: string): {
  preamble: string;
  body: string;
  postamble: string;
} {
  const bodyOpen = raw.match(/<body\b[^>]*>/i);
  const bodyClose = raw.match(/<\/body\s*>/i);
  if (
    !bodyOpen ||
    !bodyClose ||
    bodyOpen.index === undefined ||
    bodyClose.index === undefined
  ) {
    return { preamble: "", body: raw, postamble: "" };
  }
  const bodyStart = bodyOpen.index + bodyOpen[0].length;
  const bodyEnd = bodyClose.index;
  return {
    preamble: raw.slice(0, bodyStart),
    body: raw.slice(bodyStart, bodyEnd),
    postamble: raw.slice(bodyEnd),
  };
}

function encodePreamble(data: HtmlPreambleData): string {
  return JSON.stringify(data);
}

function decodePreamble(frontmatter: string | null): HtmlPreambleData | null {
  if (!frontmatter) return null;
  try {
    const parsed = JSON.parse(frontmatter) as HtmlPreambleData;
    if (
      typeof parsed.preamble !== "string" ||
      typeof parsed.postamble !== "string" ||
      typeof parsed.rawBody !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function extractCommentsFromBody(bodyHtml: string): {
  comments: Map<string, CriticComment>;
  bodyWithoutComments: string;
} {
  const { document } = parseHTML(
    `<!doctype html><html><body>${bodyHtml}</body></html>`,
  );
  const body = document.body;
  const comments = new Map<string, CriticComment>();
  const spans = body.querySelectorAll("[data-rd-comment]");
  for (const span of Array.from(spans)) {
    const id = span.getAttribute("data-rd-id");
    if (!id) continue;
    const by = span.getAttribute("data-rd-by");
    const at = span.getAttribute("data-rd-at");
    const re = span.getAttribute("data-rd-re");
    comments.set(id, {
      id,
      content: span.textContent ?? "",
      createdAt: at ?? "",
      authorType: by === "AI" ? "ai" : "user",
      authorId: by ?? null,
      parentCommentId: re?.startsWith("c") ? re : null,
    });
    span.remove();
  }
  return { comments, bodyWithoutComments: body.innerHTML };
}

export const htmlAdapter: FormatAdapter = {
  extension: ".html",

  parse(rawContent: string, _options?: ParseOptions): EditorState {
    const { preamble, body, postamble } = splitHtmlDocument(rawContent);
    const { comments, bodyWithoutComments } = extractCommentsFromBody(body);
    let doc: JSONContent;
    try {
      doc = generateJSON(bodyWithoutComments, extensions);
    } catch {
      doc = { type: "doc", content: [] };
    }
    return {
      doc,
      comments,
      frontmatter: encodePreamble({ preamble, postamble, rawBody: body }),
    };
  },

  serialize(state: EditorState): string {
    const data = decodePreamble(state.frontmatter);
    if (!data) {
      return "";
    }
    return data.preamble + data.rawBody + data.postamble;
  },

  validateReview(content: string): ValidationResult {
    return validateHtmlReview(content);
  },

  extractReviewIndex(content: string): ReviewIndex {
    return extractHtmlReviewIndex(content);
  },

  appendReply(content: string, options: ReplyOptions): string {
    return appendHtmlReply(content, options);
  },

  markResolved(content: string, options: ResolveOptions): string {
    return markHtmlResolved(content, options);
  },

  extractTitle(content: string): string | null {
    const { document } = parseHTML(content);
    const titleText = document.querySelector("title")?.textContent?.trim();
    if (titleText) return titleText;
    const h1Text = document.querySelector("h1")?.textContent?.trim();
    if (h1Text) return h1Text;
    return null;
  },
};
