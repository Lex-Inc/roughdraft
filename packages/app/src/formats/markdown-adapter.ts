import {
  appendRoughdraftReply,
  extractRoughdraftReviewIndex,
  markRoughdraftResolved,
  validateRoughdraftMarkdown,
} from "@roughdraft/rfm";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "../critic-markup";
import type {
  EditorState,
  FormatAdapter,
  ParseOptions,
  ReplyOptions,
  ResolveOptions,
  ReviewIndex,
  ValidationResult,
} from "./format-adapter";

export const markdownAdapter: FormatAdapter = {
  extension: ".md",

  parse(rawContent: string, options?: ParseOptions): EditorState {
    const { doc, comments, frontmatter } = criticMarkdownToEditorState(
      rawContent,
      options,
    );
    return { doc, comments, frontmatter };
  },

  serialize(state: EditorState): string {
    return editorStateToCriticMarkdown(state.doc, state.comments, {
      frontmatter: state.frontmatter,
    });
  },

  validateReview(content: string): ValidationResult {
    return validateRoughdraftMarkdown(content);
  },

  extractReviewIndex(content: string): ReviewIndex {
    return extractRoughdraftReviewIndex(content);
  },

  appendReply(content: string, options: ReplyOptions): string {
    return appendRoughdraftReply(content, options);
  },

  markResolved(content: string, options: ResolveOptions): string {
    return markRoughdraftResolved(content, options);
  },

  extractTitle(content: string): string | null {
    const firstLine = content.split("\n")[0] || "";
    const stripped = firstLine.replace(/^#*\s*/, "").trim();
    return stripped || null;
  },
};
