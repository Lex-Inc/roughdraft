import { generateJSON, type JSONContent } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
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

export const htmlAdapter: FormatAdapter = {
  extension: ".html",

  parse(rawContent: string, _options?: ParseOptions): EditorState {
    const { preamble, body, postamble } = splitHtmlDocument(rawContent);
    let doc: JSONContent;
    try {
      doc = generateJSON(body, extensions);
    } catch {
      doc = { type: "doc", content: [] };
    }
    return {
      doc,
      comments: new Map(),
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

  validateReview(_content: string): ValidationResult {
    throw new Error("htmlAdapter.validateReview not implemented");
  },

  extractReviewIndex(_content: string): ReviewIndex {
    throw new Error("htmlAdapter.extractReviewIndex not implemented");
  },

  appendReply(_content: string, _options: ReplyOptions): string {
    throw new Error("htmlAdapter.appendReply not implemented");
  },

  markResolved(_content: string, _options: ResolveOptions): string {
    throw new Error("htmlAdapter.markResolved not implemented");
  },

  extractTitle(_content: string): string | null {
    throw new Error("htmlAdapter.extractTitle not implemented");
  },
};
