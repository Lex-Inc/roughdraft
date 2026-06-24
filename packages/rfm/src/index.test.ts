import { describe, expect, it } from "vitest";
import {
  appendRoughdraftDocumentComment,
  appendRoughdraftReply,
  extractRoughdraftReviewIndex,
  markRoughdraftResolved,
  setRoughdraftReaction,
  validateRoughdraftMarkdown,
} from "./index";

function codes(markdown: string): string[] {
  return validateRoughdraftMarkdown(markdown).diagnostics.map(
    (diagnostic) => diagnostic.code,
  );
}

describe("validateRoughdraftMarkdown", () => {
  it("accepts valid comments, anchored comments, and suggestions", () => {
    const result = validateRoughdraftMarkdown(
      [
        'Please revisit {==this sentence==}{>>Needs a source.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}.',
        'Add {++one concrete example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"}.',
        'Use {~~rough~>specific~~}{id="s2" by="user" at="2026-04-28T12:07:00.000Z"} wording.',
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 1,
      suggestions: 2,
      legacyMetadata: 0,
    });
  });

  it("accepts root comments and suggestions backed by YAML endmatter", () => {
    const result = validateRoughdraftMarkdown(
      [
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "Add {++one concrete example++}{#s1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "suggestions:",
        "  s1:",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 1,
      suggestions: 1,
    });
  });

  it("does not validate CriticMarkup-looking text inside YAML endmatter bodies", () => {
    const result = validateRoughdraftMarkdown(
      [
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: Contains {++not a live suggestion++} in the reply.",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "    re: c1",
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 2,
      suggestions: 0,
    });
  });

  it("reports the RFM 0.2 format version", () => {
    expect(validateRoughdraftMarkdown("").version).toBe("0.2");
  });

  it("reports a missing YAML endmatter entry for compact references", () => {
    expect(codes("{>>Needs metadata<<}{#c1}\n")).toContain(
      "missing-endmatter-entry",
    );
  });

  it("accepts body-only endmatter comments as document-level feedback", () => {
    const result = validateRoughdraftMarkdown(
      [
        "{>>Root<<}{#c1}",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: Reply without parent",
        "    by: AI",
        '    at: "2026-04-28T12:01:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.summary).toMatchObject({ comments: 2 });
  });

  it("ignores review markers inside fenced code blocks and inline code spans", () => {
    const result = validateRoughdraftMarkdown(
      [
        "```md",
        "This is {>>not a comment<<}.",
        "This is {++not a suggestion++}.",
        "```",
        "Literal `{>>not a comment<<}` text.",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 0,
      suggestions: 0,
    });
  });

  it("does not treat fenced YAML examples as invalid review endmatter", () => {
    const result = validateRoughdraftMarkdown(
      [
        "Doc",
        "",
        "```yaml",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "```",
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 0,
      suggestions: 0,
    });
  });

  it("does not treat ordinary final comments sections as review endmatter without compact references", () => {
    const result = validateRoughdraftMarkdown(
      [
        "Release notes",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: docs",
        '    at: "not review metadata"',
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 0,
      suggestions: 0,
    });
  });

  it("accepts document-level comments backed only by YAML endmatter", () => {
    const result = validateRoughdraftMarkdown(
      [
        "# Draft",
        "",
        "---",
        "comments:",
        "  c1:",
        "    body: Please address the risk section.",
        "    by: user",
        '    at: "2026-05-24T12:00:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.summary).toMatchObject({
      comments: 1,
      suggestions: 0,
    });
  });

  it("reports missing canonical metadata attributes", () => {
    expect(codes("{>>Needs metadata<<}\n")).toEqual([
      "missing-metadata-id",
      "missing-metadata-by",
      "missing-metadata-at",
    ]);
  });

  it("reports invalid timestamps", () => {
    expect(
      codes('{>>Bad time<<}{id="c1" by="user" at="yesterday"}\n'),
    ).toContain("invalid-metadata-at");
  });

  it("reports unclosed review markers", () => {
    expect(codes("{++unfinished\n")).toEqual(["unclosed-addition"]);
    expect(codes("{--unfinished\n")).toEqual(["unclosed-deletion"]);
    expect(codes("{~~old text\n")).toEqual(["unclosed-substitution"]);
  });

  it("reports duplicate ids across comments and suggestions", () => {
    expect(
      codes(
        [
          '{>>First<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}',
          '{++Second++}{id="c1" by="user" at="2026-04-28T12:01:00.000Z"}',
        ].join("\n"),
      ),
    ).toContain("duplicate-id");
  });

  it("reports self replies as errors and missing reply targets as warnings", () => {
    const result = validateRoughdraftMarkdown(
      [
        '{>>Self<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z" re="c1"}',
        '{>>Missing parent<<}{id="c2" by="user" at="2026-04-28T12:01:00.000Z" re="missing"}',
      ].join("\n"),
    );

    expect(result.errors.map((diagnostic) => diagnostic.code)).toContain(
      "self-reply",
    );
    expect(result.warnings.map((diagnostic) => diagnostic.code)).toContain(
      "missing-reply-target",
    );
    expect(result.ok).toBe(false);
  });

  it("accepts legacy metadata with a warning", () => {
    const result = validateRoughdraftMarkdown(
      "{>>Legacy<<}{@id:c1; by:AI; at:2026-04-28T12:00:00.000Z@}\n",
    );

    expect(result.ok).toBe(true);
    expect(result.warnings.map((diagnostic) => diagnostic.code)).toEqual([
      "legacy-metadata",
    ]);
    expect(result.summary.legacyMetadata).toBe(1);
  });

  it("reports CRLF source locations with one-based line and column", () => {
    const result = validateRoughdraftMarkdown(
      "First line\r\n{>>Needs metadata<<}\r\n",
    );

    expect(result.errors[0]).toMatchObject({
      line: 2,
      column: 1,
    });
  });
});

describe("extractRoughdraftReviewIndex", () => {
  it("extracts comments, anchored comments, replies, and suggestions", () => {
    const index = extractRoughdraftReviewIndex(
      [
        'Please revisit {==this sentence==}{>>Needs a source.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}.',
        '{>>I added one.<<}{id="c2" by="AI" at="2026-04-28T12:02:00.000Z" re="c1"}',
        'Add {++one concrete example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"}.',
        'Use {~~rough~>specific~~}{id="s2" by="user" at="2026-04-28T12:07:00.000Z"} wording.',
      ].join("\n"),
    );

    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 1,
      suggestions: 2,
      unresolved: 4,
    });
    expect(index.items.map((item) => [item.id, item.kind])).toEqual([
      ["c1", "comment"],
      ["c2", "reply"],
      ["s1", "suggestion"],
      ["s2", "suggestion"],
    ]);
    expect(index.items[0]).toMatchObject({
      anchorText: "this sentence",
      author: "user",
      line: 1,
      column: 35,
      text: "Needs a source.",
    });
    expect(index.items[3]).toMatchObject({
      suggestionKind: "substitution",
      originalText: "rough",
      replacementText: "specific",
    });
  });

  it("extracts equivalent review items from YAML endmatter metadata", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "Add {++one concrete example++}{#s1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: I added one.",
        "    by: AI",
        '    at: "2026-04-28T12:02:00.000Z"',
        "    re: c1",
        "suggestions:",
        "  s1:",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "    status: resolved",
        "",
      ].join("\n"),
    );

    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 1,
      suggestions: 1,
      unresolved: 2,
    });
    expect(index.items.map((item) => [item.id, item.kind])).toEqual([
      ["c1", "comment"],
      ["s1", "suggestion"],
      ["c2", "reply"],
    ]);
    expect(index.items[0]).toMatchObject({
      anchorText: "this sentence",
      author: "user",
      text: "Needs a source.",
    });
    expect(index.items[2]).toMatchObject({
      parentId: "c1",
      author: "AI",
      text: "I added one.",
    });
  });

  it("extracts document-level comments backed only by YAML endmatter", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "# Draft",
        "",
        "---",
        "comments:",
        "  c1:",
        "    body: Please address the risk section.",
        "    by: user",
        '    at: "2026-05-24T12:00:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 0,
      suggestions: 0,
      unresolved: 1,
    });
    expect(index.items[0]).toMatchObject({
      id: "c1",
      kind: "comment",
      parentId: null,
      author: "user",
      createdAt: "2026-05-24T12:00:00.000Z",
      text: "Please address the risk section.",
    });
  });

  it("does not extract CriticMarkup-looking text inside YAML endmatter bodies", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "  c2:",
        "    body: Contains {++not a live suggestion++} in the reply.",
        "    by: AI",
        '    at: "2026-04-28T12:05:00.000Z"',
        "    re: c1",
        "",
      ].join("\n"),
    );

    expect(index.version).toBe("0.2");
    expect(index.summary).toMatchObject({
      comments: 1,
      replies: 1,
      suggestions: 0,
    });
    expect(index.items.map((item) => [item.id, item.kind])).toEqual([
      ["c1", "comment"],
      ["c2", "reply"],
    ]);
    expect(index.items[1]).toMatchObject({
      text: "Contains {++not a live suggestion++} in the reply.",
    });
  });

  it("preserves literal CriticMarkup inside inline code and fenced code blocks", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "```md",
        '{>>not a comment<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}',
        "```",
        'Literal `{++not a suggestion++}{id="s1" by="AI" at="2026-04-28T12:01:00.000Z"}` text.',
      ].join("\n"),
    );

    expect(index.items).toEqual([]);
    expect(index.summary).toMatchObject({
      comments: 0,
      replies: 0,
      suggestions: 0,
      unresolved: 0,
    });
  });

  it("uses only the final YAML block as Roughdraft endmatter", () => {
    const index = extractRoughdraftReviewIndex(
      [
        "Intro",
        "",
        "---",
        "",
        "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "",
      ].join("\n"),
    );

    expect(index.items).toHaveLength(1);
    expect(index.items[0]).toMatchObject({
      id: "c1",
      author: "user",
    });
  });
});

describe("RFM mutation helpers", () => {
  it("appends a reply without rewriting unrelated Markdown", () => {
    const markdown =
      '# Plan\n\nKeep {==this claim==}{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"} as written.\n';

    const updated = appendRoughdraftReply(markdown, {
      parentId: "c1",
      id: "c2",
      author: "AI",
      at: "2026-04-28T12:10:00.000Z",
      message: "Added a citation in the next paragraph.",
    });

    expect(updated).toBe(
      '# Plan\n\nKeep {==this claim==}{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}{>>Added a citation in the next paragraph.<<}{id="c2" by="AI" at="2026-04-28T12:10:00.000Z" re="c1"} as written.\n',
    );
  });

  it("appends a reply to YAML endmatter without adding inline reply markup", () => {
    const markdown = [
      "# Plan",
      "",
      "Keep {==this claim==}{>>Needs proof<<}{#c1} as written.",
      "",
      "---",
      "workflow:",
      "  owner: editorial",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-04-28T12:00:00.000Z"',
      "",
    ].join("\n");

    const updated = appendRoughdraftReply(markdown, {
      parentId: "c1",
      id: "c2",
      author: "AI",
      at: "2026-04-28T12:10:00.000Z",
      message: "Added a citation in the next paragraph.",
    });

    expect(updated).not.toContain("{>>Added a citation");
    expect(updated).toContain("workflow:\n  owner: editorial");
    expect(updated).toContain("body: Added a citation in the next paragraph.");
    expect(extractRoughdraftReviewIndex(updated).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "c2",
          kind: "reply",
          parentId: "c1",
        }),
      ]),
    );
  });

  it("appends a document-level comment to YAML endmatter with the next comment id", () => {
    const output = appendRoughdraftDocumentComment(
      [
        "# Draft",
        "",
        "Needs {==support==}{>>Add a source<<}{#c1}.",
        "",
        "---",
        "comments:",
        "  c1:",
        "    by: user",
        '    at: "2026-04-28T12:00:00.000Z"',
        "workflow:",
        "  owner: editorial",
        "",
      ].join("\n"),
      {
        message: "Please address the risk section.",
        author: "user",
        at: "2026-05-24T12:00:00.000Z",
      },
    );

    expect(output).toContain("workflow:\n  owner: editorial");
    expect(output).toContain("  c2:");
    expect(output).toContain("    body: Please address the risk section.");
    expect(output).toContain("    by: user");
    expect(output).toContain("    at: 2026-05-24T12:00:00.000Z");
  });

  it("rejects reply text that would close CriticMarkup early", () => {
    const markdown =
      '{>>Needs proof<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"}\n';

    expect(() =>
      appendRoughdraftReply(markdown, {
        parentId: "c1",
        id: "c2",
        author: "AI",
        at: "2026-04-28T12:10:00.000Z",
        message: "This closes early <<} and corrupts the thread.",
      }),
    ).toThrow(/CriticMarkup close delimiter/);
  });

  it("marks a target resolved without changing unrelated markup", () => {
    const markdown =
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n';

    const updated = markRoughdraftResolved(markdown, {
      targetId: "s1",
      summary: "Accepted in draft.",
    });

    expect(updated).toBe(
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z" status="resolved" resolved="Accepted in draft."} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n',
    );
  });

  it("marks an endmatter-backed target resolved in YAML", () => {
    const markdown = [
      "Add {++one example++}{#s1}.",
      "",
      "---",
      "workflow:",
      "  owner: editorial",
      "suggestions:",
      "  s1:",
      "    by: AI",
      '    at: "2026-04-28T12:05:00.000Z"',
      "",
    ].join("\n");

    const updated = markRoughdraftResolved(markdown, {
      targetId: "s1",
      summary: "Accepted in draft.",
    });

    expect(updated).toContain("status: resolved");
    expect(updated).toContain("resolved: Accepted in draft.");
    expect(updated).toContain("workflow:\n  owner: editorial");
    expect(extractRoughdraftReviewIndex(updated).items[0]).toMatchObject({
      id: "s1",
      status: "resolved",
    });
  });
});

describe("comment reactions", () => {
  it("extracts an inline comment reaction", () => {
    const markdown =
      'Keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z" reaction="up"}.\n';

    const comment = extractRoughdraftReviewIndex(markdown).items.find(
      (item) => item.id === "c1",
    );

    expect(comment?.reaction).toBe("up");
  });

  it("extracts an endmatter-backed comment reaction", () => {
    const markdown = [
      "Keep {>>open question<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-04-28T12:06:00.000Z"',
      "    reaction: clarify",
      "",
    ].join("\n");

    const comment = extractRoughdraftReviewIndex(markdown).items.find(
      (item) => item.id === "c1",
    );

    expect(comment?.reaction).toBe("clarify");
  });

  it("defaults reaction to null when absent and ignores invalid values", () => {
    const markdown =
      'Keep {>>q1<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"} and {>>q2<<}{id="c2" by="user" at="2026-04-28T12:07:00.000Z" reaction="meh"}.\n';

    const index = extractRoughdraftReviewIndex(markdown);
    expect(index.items.find((item) => item.id === "c1")?.reaction).toBeNull();
    expect(index.items.find((item) => item.id === "c2")?.reaction).toBeNull();
  });

  it("tallies reactions in the review index summary", () => {
    const markdown =
      'Keep {>>q1<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z" reaction="up"} and {>>q2<<}{id="c2" by="user" at="2026-04-28T12:07:00.000Z" reaction="up"} and {>>q3<<}{id="c3" by="user" at="2026-04-28T12:08:00.000Z" reaction="clarify"} and {>>q4<<}{id="c4" by="user" at="2026-04-28T12:09:00.000Z"}.\n';

    expect(extractRoughdraftReviewIndex(markdown).summary.reactions).toEqual({
      up: 2,
      down: 0,
      clarify: 1,
    });
  });

  it("sets a reaction on an inline comment without changing unrelated markup", () => {
    const markdown =
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n';

    const updated = setRoughdraftReaction(markdown, {
      targetId: "c1",
      reaction: "down",
    });

    expect(updated).toBe(
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"} and keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z" reaction="down"}.\n',
    );
  });

  it("sets a reaction on an endmatter-backed comment in YAML", () => {
    const markdown = [
      "Keep {>>open question<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2026-04-28T12:06:00.000Z"',
      "",
    ].join("\n");

    const updated = setRoughdraftReaction(markdown, {
      targetId: "c1",
      reaction: "up",
    });

    expect(updated).toContain("reaction: up");
    expect(extractRoughdraftReviewIndex(updated).items[0]).toMatchObject({
      id: "c1",
      reaction: "up",
    });
  });

  it("clears a reaction when passed null", () => {
    const markdown =
      'Keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z" reaction="up"}.\n';

    const updated = setRoughdraftReaction(markdown, {
      targetId: "c1",
      reaction: null,
    });

    expect(updated).not.toContain("reaction=");
    expect(extractRoughdraftReviewIndex(updated).items[0]?.reaction).toBeNull();
  });

  it("rejects reactions on suggestions", () => {
    const markdown =
      'Add {++one example++}{id="s1" by="AI" at="2026-04-28T12:05:00.000Z"}.\n';

    expect(() =>
      setRoughdraftReaction(markdown, { targetId: "s1", reaction: "up" }),
    ).toThrow();
  });

  it("rejects an unknown reaction value", () => {
    const markdown =
      'Keep {>>open question<<}{id="c1" by="user" at="2026-04-28T12:06:00.000Z"}.\n';

    expect(() =>
      setRoughdraftReaction(markdown, {
        targetId: "c1",
        // @ts-expect-error invalid reaction
        reaction: "love",
      }),
    ).toThrow();
  });
});
