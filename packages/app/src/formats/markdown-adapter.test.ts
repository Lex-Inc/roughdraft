import { describe, expect, it } from "vitest";
import {
  appendRoughdraftReply,
  extractRoughdraftReviewIndex,
} from "@roughdraft/rfm";
import { markdownAdapter } from "./markdown-adapter";

const fixtureWithComment = `---
title: Test Doc
---

# Heading

A paragraph with a {==highlighted phrase==}{>>What do you think?<<}{id="c1" by="AI" at="2026-05-22T10:00:00Z" re="h1"} inside.
`;

describe("markdownAdapter", () => {
  it("parses frontmatter, body, and comments from a markdown document", () => {
    const state = markdownAdapter.parse(fixtureWithComment);

    expect(state.frontmatter).toContain("title: Test Doc");
    expect(state.doc).toBeDefined();
    expect(state.comments.size).toBeGreaterThan(0);
  });

  it("round-trips a document such that the review index is preserved", () => {
    const state = markdownAdapter.parse(fixtureWithComment);
    const serialized = markdownAdapter.serialize(state);

    const originalIndex = extractRoughdraftReviewIndex(fixtureWithComment);
    const roundtripIndex = extractRoughdraftReviewIndex(serialized);

    expect(roundtripIndex.summary).toEqual(originalIndex.summary);
    expect(roundtripIndex.items.map((item) => item.id)).toEqual(
      originalIndex.items.map((item) => item.id),
    );
  });

  it("delegates extractReviewIndex to rfm with the same result", () => {
    expect(markdownAdapter.extractReviewIndex(fixtureWithComment)).toEqual(
      extractRoughdraftReviewIndex(fixtureWithComment),
    );
  });

  it("delegates appendReply to rfm with the same result", () => {
    const replyOptions = {
      parentId: "c1",
      message: "Agreed, let me revise.",
      author: "Ignat",
      at: "2026-05-22T11:00:00Z",
      id: "c2",
    };

    expect(
      markdownAdapter.appendReply(fixtureWithComment, replyOptions),
    ).toEqual(appendRoughdraftReply(fixtureWithComment, replyOptions));
  });

  it("extracts the first heading as the title", () => {
    expect(markdownAdapter.extractTitle("# My Document\n\nBody")).toBe(
      "My Document",
    );
  });

  it("falls back to the first non-empty line when there is no heading", () => {
    expect(markdownAdapter.extractTitle("Just a paragraph\nMore text")).toBe(
      "Just a paragraph",
    );
  });

  it("returns null for empty content", () => {
    expect(markdownAdapter.extractTitle("")).toBeNull();
    expect(markdownAdapter.extractTitle("   ")).toBeNull();
  });

  it("declares its file extension", () => {
    expect(markdownAdapter.extension).toBe(".md");
  });
});
