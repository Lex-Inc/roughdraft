import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import {
  createCriticChange,
  createNextChangeId,
  createNextCommentId,
  criticMarkdownHasReviewRail,
  criticMarkdownToEditorState,
  criticMarkdownToRenderedHtml,
  editorStateToCriticMarkdown,
  getCommentDescendantIds,
} from "../src/critic-markup";
import { createEditorExtensions } from "../src/editor-extensions";

function readMarkdownFixture(name: string): string {
  return `${fs
    .readFileSync(
      path.join(process.cwd(), "test", "fixtures", "markdown", name),
      "utf8",
    )
    .trimEnd()}\n`;
}

describe("CriticMarkup comments", () => {
  it("preserves YAML frontmatter delimiters and raw table-like YAML text", () => {
    const input = [
      "---",
      "title: Frontmatter round trip",
      "summary: |",
      "  | column | value |",
      "  | --- | --- |",
      "  | path | docs/table.md |",
      "tags:",
      "  - roughdraft",
      "---",
      "",
      "# Body",
      "Opening this file in rich text should not rewrite frontmatter.",
      "",
    ].join("\n");

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("detects review rail content without counting fenced examples", () => {
    expect(
      criticMarkdownHasReviewRail(
        [
          "```md",
          "This is {--deleted--} text.",
          "This is {++inserted++} text.",
          "This is {~~old~>new~~} substituted text.",
          "This is {>>a comment<<} in the margin.",
          "```",
        ].join("\n"),
      ),
    ).toBe(false);
    expect(
      criticMarkdownHasReviewRail(
        [
          "<details>",
          "<summary>Literal examples</summary>",
          "",
          "{==example==}{>>First paragraph.",
          "",
          'Second paragraph.<<}{id="c61" by="AI" at="2026-05-24T18:50:00.000Z"}',
          "",
          "</details>",
          "",
        ].join("\n"),
      ),
    ).toBe(false);

    expect(
      criticMarkdownHasReviewRail(
        'This is {==anchored text==}{>>a threaded comment<<}{id="c1" by="user" at="2026-04-23T18:00:00.000Z"}.\n',
      ),
    ).toBe(true);
    expect(criticMarkdownHasReviewRail("This is {++inserted++} text.\n")).toBe(
      true,
    );
  });

  it("round-trips a highlighted comment anchor", () => {
    const input =
      'This is {==highlighted==}{>>comment text<<}{id="cmt1" by="AI" at="2024-01-15T10:30:00.000Z"} text.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("cmt1")).toMatchObject({
      id: "cmt1",
      content: "comment text",
      authorType: "ai",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("does not render raw legacy metadata when inline comment bodies contain blank lines", () => {
    const input = [
      "This is {==text==}{>>First paragraph.",
      "",
      '- Second paragraph.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z"} text.',
      "",
    ].join("\n");

    const { html, comments } = criticMarkdownToRenderedHtml(input);
    const renderedText =
      new DOMParser().parseFromString(html, "text/html").body.textContent ?? "";

    expect(renderedText).not.toContain('<<}{id="c1"');
    expect(comments.get("c1")).toMatchObject({
      id: "c1",
      content: "First paragraph.\n\n- Second paragraph.",
      authorType: "user",
    });

    const parsed = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(parsed.doc, parsed.comments);

    expect(output).toContain("{==text==}{>><<}{#c1}");
    expect(output).toContain("body: |");
    expect(output).toContain("First paragraph.");
    expect(output).toContain("- Second paragraph.");
    expect(output).not.toContain('<<}{id="c1"');
  });

  it("renders YAML endmatter-backed root comments and replies", () => {
    const input = [
      "This is {==highlighted==}{>>comment text<<}{#c1} text.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: AI",
      '    at: "2024-01-15T10:30:00.000Z"',
      "  c2:",
      "    body: Reply text",
      "    by: user",
      '    at: "2024-01-15T10:31:00.000Z"',
      "    re: c1",
      "",
    ].join("\n");

    const { doc, comments, endmatter } = criticMarkdownToEditorState(input);

    expect(endmatter).toContain("comments:");
    expect(comments.get("c1")).toMatchObject({
      id: "c1",
      content: "comment text",
      authorType: "ai",
    });
    expect(comments.get("c2")).toMatchObject({
      id: "c2",
      content: "Reply text",
      parentCommentId: "c1",
    });
    const output = editorStateToCriticMarkdown(doc, comments);
    expect(output).toContain("{==highlighted==}{>>comment text<<}{#c1}");
    expect(output).toContain("body: Reply text");
    expect(output).toContain("re: c1");
  });

  it("does not treat horizontal rules and fenced YAML examples as review endmatter", () => {
    const input = [
      "# Markdown examples",
      "",
      "A normal horizontal rule follows.",
      "",
      "---",
      "",
      "```yaml",
      "comments:",
      "  c1:",
      "    body: This is documentation, not review metadata.",
      "suggestions:",
      "  s1:",
      "    by: AI",
      "```",
      "",
    ].join("\n");

    const { doc, comments, endmatter } = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(doc, comments);

    expect(endmatter).toBeNull();
    expect(comments.size).toBe(0);
    expect(output).toContain("* * *");
    expect(output).toContain("```yaml");
    expect(output).toContain("comments:");
    expect(output).toContain("suggestions:");
    expect(output).toContain("This is documentation, not review metadata.");
  });

  it("does not treat ordinary final comments sections as review endmatter", () => {
    const input = [
      "# Release notes",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: docs",
      '    at: "not review metadata"',
      "",
    ].join("\n");

    const { doc, comments, endmatter } = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(doc, comments);

    expect(endmatter).toBeNull();
    expect(comments.size).toBe(0);
    expect(output).toContain("comments:");
    expect(output).toContain("not review metadata");
  });

  it("writes YAML metadata for new suggestions in endmatter-backed documents", () => {
    const input = [
      "Replace {++draft++}{#s1}.",
      "",
      "---",
      "suggestions:",
      "  s1:",
      "    by: AI",
      '    at: "2026-05-24T10:00:00.000Z"',
      "",
    ].join("\n");
    const parsed = criticMarkdownToEditorState(input);
    const nextDoc = structuredClone(parsed.doc);
    const paragraph = nextDoc.content?.[0];

    paragraph?.content?.push(
      { type: "text", text: " Add " },
      {
        type: "text",
        text: "specifics",
        marks: [
          {
            type: "criticChange",
            attrs: createCriticChange("addition", {
              changeId: "s2",
              createdAt: "2026-05-24T11:00:00.000Z",
              authorType: "user",
              authorId: "user",
            }),
          },
        ],
      },
      { type: "text", text: "." },
    );

    const output = editorStateToCriticMarkdown(nextDoc, parsed.comments);

    expect(output).toContain("{++specifics++}{#s2}");
    expect(output).toContain("suggestions:");
    expect(output).toContain("s1:");
    expect(output).toContain("s2:");
    expect(output).toContain("at: 2026-05-24T11:00:00.000Z");
  });

  it("removes deleted comments and replies from YAML endmatter", () => {
    const input = [
      "Please revisit {==this claim==}{>>Needs a source.<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: Nora",
      '    at: "2026-05-24T10:45:00.000Z"',
      "  c2:",
      "    body: I can soften this.",
      "    by: AI",
      '    at: "2026-05-24T10:46:00.000Z"',
      "    re: c1",
      "  c3:",
      "    body: Stale reply.",
      "    by: AI",
      '    at: "2026-05-24T10:47:00.000Z"',
      "    re: c1",
      "",
    ].join("\n");
    const { doc, comments } = criticMarkdownToEditorState(input);
    const nextComments = new Map(comments);

    nextComments.delete("c2");
    nextComments.delete("c3");

    const output = editorStateToCriticMarkdown(doc, nextComments);

    expect(output).toContain("comments:");
    expect(output).toContain("c1:");
    expect(output).not.toContain("c2:");
    expect(output).not.toContain("c3:");
    expect(output).not.toContain("I can soften this.");
    expect(output).not.toContain("Stale reply.");
  });

  it("preserves unknown top-level YAML endmatter keys on save", () => {
    const input = [
      "Please revisit {==this claim==}{>>Needs a source.<<}{#c1}.",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: Nora",
      '    at: "2026-05-24T10:45:00.000Z"',
      "workflow:",
      "  owner: editorial",
      "",
    ].join("\n");

    const { doc, comments } = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(doc, comments);

    expect(output).toContain("workflow:");
    expect(output).toContain("owner: editorial");
  });

  it("renders YAML endmatter-backed unanchored comments", () => {
    const input = [
      "This paragraph has an unanchored note.{>>Consider whether this belongs in the executive summary instead.<<}{#c3}",
      "",
      "---",
      "comments:",
      "  c3:",
      "    by: user",
      '    at: "2026-05-24T17:00:00.000Z"',
      "",
    ].join("\n");

    expect(criticMarkdownHasReviewRail(input)).toBe(true);

    const { html, comments } = criticMarkdownToRenderedHtml(input);
    const parsed = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(parsed.doc, parsed.comments);

    expect(comments.get("c3")).toMatchObject({
      id: "c3",
      content:
        "Consider whether this belongs in the executive summary instead.",
      authorType: "user",
      createdAt: "2026-05-24T17:00:00.000Z",
    });
    expect(html).toContain('data-comment-ids="[&quot;c3&quot;]"');
    expect(html).toContain('data-comment-anchorless="true"');
    expect(html).not.toContain("{&gt;&gt;Consider whether");
    expect(output).toContain(
      "This paragraph has an unanchored note.{>>Consider whether this belongs in the executive summary instead.<<}{#c3}",
    );
    expect(output).not.toContain("{==\u2060==}");
  });

  it("renders and preserves YAML endmatter-backed document-level comments", () => {
    const input = [
      "# Draft",
      "",
      "---",
      "comments:",
      "  c1:",
      "    body: Please address the risk section.",
      "    by: user",
      '    at: "2026-05-24T12:00:00.000Z"',
      "",
    ].join("\n");

    expect(criticMarkdownHasReviewRail(input)).toBe(true);

    const parsed = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(parsed.doc, parsed.comments);

    expect(parsed.comments.get("c1")).toMatchObject({
      id: "c1",
      content: "Please address the risk section.",
      authorType: "user",
      createdAt: "2026-05-24T12:00:00.000Z",
      parentCommentId: null,
      scope: "document",
    });
    expect(output).toContain("comments:");
    expect(output).toContain("  c1:");
    expect(output).toContain("    body: Please address the risk section.");
    expect(output).not.toContain("{#c1}");
  });

  it("reserves YAML endmatter-backed unanchored comment ids for new replies", () => {
    const input = [
      "Please revisit {==this claim==}{>>This needs a source.<<}{#c1}.",
      "",
      "This paragraph has an unanchored note.{>>Consider whether this belongs in the executive summary instead.<<}{#c3}",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: Nora",
      '    at: "2026-05-24T10:45:00.000Z"',
      "  c2:",
      "    body: I can soften the claim if we do not have a citation.",
      "    by: AI",
      '    at: "2026-05-24T10:46:00.000Z"',
      "    re: c1",
      "  c3:",
      "    by: user",
      '    at: "2026-05-24T17:00:00.000Z"',
      "suggestions:",
      "  s1:",
      "    by: AI",
      '    at: "2026-05-24T10:48:00.000Z"',
      "",
    ].join("\n");

    const { comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c3")).toMatchObject({
      id: "c3",
      content:
        "Consider whether this belongs in the executive summary instead.",
      parentCommentId: null,
    });
    expect(createNextCommentId(comments.values())).toBe("c4");
  });

  it("repairs stale YAML reply metadata when an inline root comment id was reused", () => {
    const input = [
      "Add {++one concrete customer example++}{#s1}.",
      "",
      "This paragraph has an unanchored note.{>>Consider whether this belongs in the executive summary instead.<<}{#c3}",
      "",
      "---",
      "comments:",
      "  c3:",
      "    by: user",
      '    at: "2026-05-24T17:38:55.763Z"',
      "    body: reply to suggestion",
      "    re: s1",
      "suggestions:",
      "  s1:",
      "    by: AI",
      '    at: "2026-05-24T10:48:00.000Z"',
      "",
    ].join("\n");

    const { doc, comments } = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(doc, comments);

    expect(comments.get("c3")).toMatchObject({
      id: "c3",
      content:
        "Consider whether this belongs in the executive summary instead.",
      parentCommentId: null,
    });
    expect(output).toContain(
      "This paragraph has an unanchored note.{>>Consider whether this belongs in the executive summary instead.<<}{#c3}",
    );
    expect(output).not.toContain("body: reply to suggestion");
    expect(output).not.toContain("re: s1");
    expect(createNextCommentId(comments.values())).toBe("c4");
  });

  it("renders YAML endmatter-backed suggestions", () => {
    const input = [
      "Add {++one concrete example++}{#s1}.",
      "",
      "---",
      "suggestions:",
      "  s1:",
      "    by: AI",
      '    at: "2024-01-15T10:30:00.000Z"',
      "",
    ].join("\n");

    const { changes } = criticMarkdownToRenderedHtml(input);

    expect(changes.get("s1")).toMatchObject({
      changeId: "s1",
      authorType: "ai",
      createdAt: "2024-01-15T10:30:00.000Z",
    });
  });

  it("preserves formatting nested inside a comment anchor", () => {
    const input =
      'The {==**important**==}{>>Review this phrasing<<}{id="cmt2" by="user@example.com" at="2024-01-15T10:31:00.000Z"} section stays bold.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("preserves inline code nested inside a comment anchor", () => {
    const input =
      'Check {==`roughdraft open`==}{>>Make sure this command is visible<<}{id="cmt-code" by="user" at="2024-01-15T10:31:00.000Z"} before sharing.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);
    const paragraph = doc.content?.[0];
    const codeNode = paragraph?.content?.[1];

    expect(codeNode).toMatchObject({
      type: "text",
      text: "roughdraft open",
      marks: expect.arrayContaining([
        expect.objectContaining({
          type: "commentRef",
          attrs: expect.objectContaining({ commentIds: ["cmt-code"] }),
        }),
        expect.objectContaining({ type: "code" }),
      ]),
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("creates one comment anchor when a selection spans inline code", () => {
    const input =
      "Each dev wrapper keeps its own server state under `~/.roughdraft/dev/<wrapper-name>` by default, so opening works.\n";
    const { doc } = criticMarkdownToEditorState(input);
    const editor = new Editor({
      extensions: createEditorExtensions(""),
      content: doc,
    });

    try {
      const text = editor.state.doc.textBetween(
        0,
        editor.state.doc.content.size,
        "\n",
      );
      const start = text.indexOf("its own server state under");
      const end = text.indexOf(" by default") + " by default".length;

      editor.commands.setTextSelection({ from: start + 1, to: end + 1 });
      editor.commands.setCommentRef({ commentIds: ["c1"] });

      expect(
        editorStateToCriticMarkdown(
          editor.getJSON(),
          new Map([
            [
              "c1",
              {
                id: "c1",
                content: "test",
                createdAt: "2026-04-25T21:54:47.475Z",
              },
            ],
          ]),
        ),
      ).toBe(
        'Each dev wrapper keeps {==its own server state under `~/.roughdraft/dev/<wrapper-name>` by default==}{>>test<<}{id="c1" by="user" at="2026-04-25T21:54:47.475Z"}, so opening works.\n',
      );
    } finally {
      editor.destroy();
    }
  });

  it("keeps the anchor attached when nearby text changes", () => {
    const input =
      'Before {==target==}{>>Check this<<}{id="cmt3" by="AI" at="2024-01-15T10:32:00.000Z"} after.\n';
    const { doc, comments } = criticMarkdownToEditorState(input);
    const nextDoc = structuredClone(doc);
    const firstParagraph = nextDoc.content?.[0];
    const firstTextNode = firstParagraph?.content?.[0];

    if (firstTextNode?.type !== "text") {
      throw new Error("Expected leading text node in parsed paragraph");
    }

    firstTextNode.text = "Before nearby ";

    expect(editorStateToCriticMarkdown(nextDoc, comments)).toBe(
      'Before nearby {==target==}{>>Check this<<}{id="cmt3" by="AI" at="2024-01-15T10:32:00.000Z"} after.\n',
    );
  });

  it("round-trips comments inside list items and headings", () => {
    const input = `## Sprint Notes

* First item
* {==Second item==}{>>Needs review<<}{id="cmt4" by="AI" at="2024-01-15T10:33:00.000Z"}
`;

    const { doc, comments } = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(doc, comments);

    expect(output).toContain("## Sprint Notes");
    expect(output).toContain(
      '{==Second item==}{>>Needs review<<}{id="cmt4" by="AI" at="2024-01-15T10:33:00.000Z"}',
    );
    expect(output).toContain("- First item");
  });

  it("does not import a trailing blank line into fenced code blocks", () => {
    const input = `\`\`\`text
Use Roughdraft when I want to open, review, comment on, or compare markdown files.

Start it with \`roughdraft start\` if needed.
Open files or folders with \`roughdraft open "/absolute/path/to/file.md"\`.
After I finish reviewing in Roughdraft, continue by reading the markdown files from disk and making the requested changes there.
Use CriticMarkup for inline review feedback in markdown.
\`\`\`
`;

    const { doc } = criticMarkdownToEditorState(input);
    const codeBlock = doc.content?.[0];
    const textNode = codeBlock?.content?.[0];

    expect(codeBlock?.type).toBe("codeBlock");
    expect(textNode).toMatchObject({
      type: "text",
      text: `Use Roughdraft when I want to open, review, comment on, or compare markdown files.

Start it with \`roughdraft start\` if needed.
Open files or folders with \`roughdraft open "/absolute/path/to/file.md"\`.
After I finish reviewing in Roughdraft, continue by reading the markdown files from disk and making the requested changes there.
Use CriticMarkup for inline review feedback in markdown.`,
    });
    expect(editorStateToCriticMarkdown(doc, new Map())).toBe(input);
  });

  it("creates a comment anchor when a selection is inside a fenced code block", () => {
    const input = `\`\`\`ts
const command = "roughdraft open";
\`\`\`
`;
    const { doc } = criticMarkdownToEditorState(input);
    const editor = new Editor({
      extensions: createEditorExtensions(""),
      content: doc,
    });

    try {
      const text = editor.state.doc.textBetween(
        0,
        editor.state.doc.content.size,
        "\n",
      );
      const start = text.indexOf("roughdraft open");
      const end = start + "roughdraft open".length;

      editor.commands.setTextSelection({ from: start + 1, to: end + 1 });
      const added = editor.commands.setCommentRef({ commentIds: ["c1"] });

      expect(added).toBe(true);
      expect(editor.getJSON().content?.[0]).toMatchObject({
        type: "codeBlock",
        attrs: { language: "ts" },
        content: [
          {
            type: "text",
            text: 'const command = "',
          },
          {
            type: "text",
            text: "roughdraft open",
            marks: [
              {
                type: "commentRef",
                attrs: { commentIds: ["c1"] },
              },
            ],
          },
          {
            type: "text",
            text: '";',
          },
        ],
      });
      expect(
        editorStateToCriticMarkdown(
          editor.getJSON(),
          new Map([
            [
              "c1",
              {
                id: "c1",
                content: "test",
                createdAt: "2026-04-25T22:14:08.827Z",
              },
            ],
          ]),
        ),
      ).toBe(`\`\`\`ts
const command = "{==roughdraft open==}{>>test<<}{id="c1" by="user" at="2026-04-25T22:14:08.827Z"}";
\`\`\`
`);
    } finally {
      editor.destroy();
    }
  });

  it("round-trips comment anchors inside fenced code blocks", () => {
    const input = `\`\`\`ts
const command = "{==roughdraft open==}{>>test<<}{id="c1" by="user" at="2026-04-25T22:14:08.827Z"}";
\`\`\`
`;

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(doc.content?.[0]).toMatchObject({
      type: "codeBlock",
      attrs: { language: "ts" },
      content: [
        {
          type: "text",
          text: 'const command = "',
        },
        {
          type: "text",
          text: "roughdraft open",
          marks: [
            {
              type: "commentRef",
              attrs: { commentIds: ["c1"] },
            },
          ],
        },
        {
          type: "text",
          text: '";',
        },
      ],
    });
    expect(comments.get("c1")).toMatchObject({
      id: "c1",
      content: "test",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("round-trips an anchored reply thread", () => {
    const input =
      'Please revisit {==this sentence==}{>>Needs a source<<}{id="c1" by="user" at="2024-01-15T10:30:00.000Z"}{>>I can add one from the intro.<<}{id="c2" by="AI" at="2024-01-15T10:31:00.000Z" re="c1"}.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c2")).toMatchObject({
      id: "c2",
      parentCommentId: "c1",
      authorType: "ai",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("round-trips nested replies in preorder", () => {
    const input =
      'Please revisit {==this sentence==}{>>Needs a source<<}{id="c1" by="user" at="2024-01-15T10:30:00.000Z"}{>>I can add one from the intro.<<}{id="c2" by="AI" at="2024-01-15T10:31:00.000Z" re="c1"}{>>Use the market report too.<<}{id="c3" by="user" at="2024-01-15T10:32:00.000Z" re="c2"}.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c3")).toMatchObject({
      id: "c3",
      parentCommentId: "c2",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("migrates legacy metadata to attribute metadata on save", () => {
    const input =
      "Please revisit {==this sentence==}{>>Needs a source<<}{@id:c1;by:user;at:2024-01-15T10:30:00.000Z@}.\n";

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c1")).toMatchObject({
      id: "c1",
      content: "Needs a source",
      authorType: "user",
      authorId: "user",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(
      'Please revisit {==this sentence==}{>>Needs a source<<}{id="c1" by="user" at="2024-01-15T10:30:00.000Z"}.\n',
    );
  });

  it("round-trips escaped attribute metadata values", () => {
    const input =
      'Please revisit {==this sentence==}{>>Needs a source<<}{id="c1" by="user\\\\\\"name" at="2024-01-15T10:30:00.000Z"}.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c1")).toMatchObject({
      authorId: 'user\\"name',
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it.each([
    "criticmarkup-basic.md",
    "criticmarkup-code-fences.md",
    "frontmatter-table-yaml.md",
    "mixed-roundtrip.md",
  ])("round-trips markdown fixture %s", (fixtureName) => {
    const input = readMarkdownFixture(fixtureName);
    const { doc, comments, frontmatter } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments, { frontmatter })).toBe(
      input,
    );
  });

  it("keeps unanchored CriticMarkup examples literal in code spans and fenced code", () => {
    const input = readMarkdownFixture("criticmarkup-code-fences.md");
    const { doc, comments, frontmatter } = criticMarkdownToEditorState(input);

    expect(comments.size).toBe(0);
    expect(editorStateToCriticMarkdown(doc, comments, { frontmatter })).toBe(
      input,
    );
  });

  it("allocates simple document-local ids", () => {
    expect(
      createNextCommentId([{ id: "c2" }, { id: "note-1" }, { id: "c7" }]),
    ).toBe("c8");
  });

  it("allocates simple document-local suggestion ids", () => {
    expect(
      createNextChangeId([
        { changeId: "s2" },
        { changeId: "suggestion-1" },
        { changeId: "s7" },
      ]),
    ).toBe("s8");
  });

  it("round-trips an insertion suggestion with metadata", () => {
    const input =
      'Add {++new text++}{id="s1" by="user" at="2024-01-15T10:30:00.000Z"} here.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("round-trips a deletion suggestion with metadata", () => {
    const input =
      'Remove {--old text--}{id="s2" by="AI" at="2024-01-15T10:31:00.000Z"} here.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("round-trips a substitution suggestion with metadata", () => {
    const input =
      'Use {~~old text~>new text~~}{id="s3" by="user@example.com" at="2024-01-15T10:32:00.000Z"} here.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("round-trips a substitution suggestion with an attached comment", () => {
    const input =
      'Use {~~old text~>new text~~}{id="s3" by="AI" at="2024-01-15T10:32:00.000Z"}{>>Confirm this with legal.<<}{id="c1" by="user" at="2024-01-15T10:33:00.000Z" re="s3"} here.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c1")).toMatchObject({
      id: "c1",
      content: "Confirm this with legal.",
      parentCommentId: "s3",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("renders review markup to HTML with comments and changes", () => {
    const input =
      'Keep {==the launch date==}{>>Verify this.<<}{id="c1" by="user" at="2024-01-15T10:33:00.000Z"} and add {++the customer quote++}{id="s1" by="AI" at="2024-01-15T10:34:00.000Z"}.\n';

    const { html, comments, changes, frontmatter } =
      criticMarkdownToRenderedHtml(input);

    expect(frontmatter).toBeNull();
    expect(comments.get("c1")?.content).toBe("Verify this.");
    expect(changes.get("s1")).toMatchObject({
      changeId: "s1",
      kind: "addition",
      authorType: "ai",
    });
    expect(html).toContain('data-comment-ids="[&quot;c1&quot;]"');
    expect(html).toContain('data-critic-change-kind="addition"');
  });

  it("imports suggestions without metadata and serializes generated metadata", () => {
    const { doc, comments } = criticMarkdownToEditorState(
      "Add {++new text++} here.\n",
    );

    expect(editorStateToCriticMarkdown(doc, comments)).toMatch(
      /^Add \{\+\+new text\+\+\}\{id="s1" by="user" at="[^"]+"\} here\.\n$/,
    );
  });

  it("preserves Markdown formatting inside suggested changes", () => {
    const input =
      'Use {++**bold** and `code`++}{id="s1" by="user" at="2024-01-15T10:30:00.000Z"} here.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("preserves suggested changes next to comments", () => {
    const input =
      'Add {++new text++}{id="s1" by="user" at="2024-01-15T10:30:00.000Z"} near {==this==}{>>Check it<<}{id="c1" by="AI" at="2024-01-15T10:31:00.000Z"}.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("round-trips a comment whose parent points to a suggestion id", () => {
    const input =
      '{==New wording==}{>>Why this wording?<<}{id="c1" by="user" at="2024-01-15T10:31:00.000Z" re="s1"} follows {++new text++}{id="s1" by="AI" at="2024-01-15T10:30:00.000Z"}.\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c1")).toMatchObject({
      parentCommentId: "s1",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("round-trips a comment attached directly to a suggestion", () => {
    const input =
      '{++new text++}{id="s1" by="AI" at="2024-01-15T10:30:00.000Z"}{>>Why this wording?<<}{id="c1" by="user" at="2024-01-15T10:31:00.000Z" re="s1"}\n';

    const { doc, comments } = criticMarkdownToEditorState(input);

    expect(comments.get("c1")).toMatchObject({
      parentCommentId: "s1",
    });
    expect(editorStateToCriticMarkdown(doc, comments)).toBe(input);
  });

  it("preserves suggested changes in headings and list items", () => {
    const input = `## Use {++new title++}{id="s1" by="user" at="2024-01-15T10:30:00.000Z"}

* Keep {--old item--}{id="s2" by="user" at="2024-01-15T10:31:00.000Z"}
`;

    const { doc, comments } = criticMarkdownToEditorState(input);
    const output = editorStateToCriticMarkdown(doc, comments);

    expect(output).toContain(
      '## Use {++new title++}{id="s1" by="user" at="2024-01-15T10:30:00.000Z"}',
    );
    expect(output).toContain(
      '- Keep {--old item--}{id="s2" by="user" at="2024-01-15T10:31:00.000Z"}',
    );
  });

  it("accepts and rejects insertion suggestions", () => {
    const input =
      'Add {++new text++}{id="s1" by="user" at="2024-01-15T10:30:00.000Z"} here.\n';
    const accepted = criticMarkdownToEditorState(input);
    const rejected = criticMarkdownToEditorState(input);
    const acceptEditor = new Editor({
      extensions: createEditorExtensions(""),
      content: accepted.doc,
    });
    const rejectEditor = new Editor({
      extensions: createEditorExtensions(""),
      content: rejected.doc,
    });

    try {
      acceptEditor.commands.acceptCriticChange("s1");
      rejectEditor.commands.rejectCriticChange("s1");

      expect(
        editorStateToCriticMarkdown(acceptEditor.getJSON(), accepted.comments),
      ).toBe("Add new text here.\n");
      expect(
        editorStateToCriticMarkdown(rejectEditor.getJSON(), rejected.comments),
      ).toBe("Add here.\n");
    } finally {
      acceptEditor.destroy();
      rejectEditor.destroy();
    }
  });

  it("accepts and rejects deletion suggestions", () => {
    const input =
      'Remove {--old text--}{id="s1" by="user" at="2024-01-15T10:30:00.000Z"} here.\n';
    const accepted = criticMarkdownToEditorState(input);
    const rejected = criticMarkdownToEditorState(input);
    const acceptEditor = new Editor({
      extensions: createEditorExtensions(""),
      content: accepted.doc,
    });
    const rejectEditor = new Editor({
      extensions: createEditorExtensions(""),
      content: rejected.doc,
    });

    try {
      acceptEditor.commands.acceptCriticChange("s1");
      rejectEditor.commands.rejectCriticChange("s1");

      expect(
        editorStateToCriticMarkdown(acceptEditor.getJSON(), accepted.comments),
      ).toBe("Remove here.\n");
      expect(
        editorStateToCriticMarkdown(rejectEditor.getJSON(), rejected.comments),
      ).toBe("Remove old text here.\n");
    } finally {
      acceptEditor.destroy();
      rejectEditor.destroy();
    }
  });

  it("accepts and rejects substitution suggestions", () => {
    const input =
      'Use {~~old~>new~~}{id="s1" by="user" at="2024-01-15T10:30:00.000Z"} here.\n';
    const accepted = criticMarkdownToEditorState(input);
    const rejected = criticMarkdownToEditorState(input);
    const acceptEditor = new Editor({
      extensions: createEditorExtensions(""),
      content: accepted.doc,
    });
    const rejectEditor = new Editor({
      extensions: createEditorExtensions(""),
      content: rejected.doc,
    });

    try {
      acceptEditor.commands.acceptCriticChange("s1");
      rejectEditor.commands.rejectCriticChange("s1");

      expect(
        editorStateToCriticMarkdown(acceptEditor.getJSON(), accepted.comments),
      ).toBe("Use new here.\n");
      expect(
        editorStateToCriticMarkdown(rejectEditor.getJSON(), rejected.comments),
      ).toBe("Use old here.\n");
    } finally {
      acceptEditor.destroy();
      rejectEditor.destroy();
    }
  });

  it("creates critic change attrs with document-local metadata", () => {
    expect(
      createCriticChange("addition", undefined, {
        existingChanges: [{ changeId: "s1" }],
      }),
    ).toMatchObject({
      kind: "addition",
      changeId: "s2",
      authorType: "user",
      authorId: "user",
    });
  });

  it("collects descendants in nested reply order", () => {
    const comments = new Map([
      [
        "c1",
        {
          id: "c1",
          content: "Root",
          createdAt: "2024-01-15T10:30:00.000Z",
        },
      ],
      [
        "c2",
        {
          id: "c2",
          content: "Reply",
          createdAt: "2024-01-15T10:31:00.000Z",
          parentCommentId: "c1",
        },
      ],
      [
        "c3",
        {
          id: "c3",
          content: "Nested reply",
          createdAt: "2024-01-15T10:32:00.000Z",
          parentCommentId: "c2",
        },
      ],
      [
        "c4",
        {
          id: "c4",
          content: "Sibling reply",
          createdAt: "2024-01-15T10:33:00.000Z",
          parentCommentId: "c1",
        },
      ],
    ]);

    expect(getCommentDescendantIds("c1", comments)).toEqual(["c2", "c3", "c4"]);
  });
});

function richTextRoundTrip(markdown: string): string {
  const { doc, comments, frontmatter } = criticMarkdownToEditorState(markdown);
  return editorStateToCriticMarkdown(doc, comments, { frontmatter });
}

describe("Markdown rich-text round-trip regressions", () => {
  it("preserves GFM strikethrough markup", () => {
    const input = "Keep ~~removed~~ and **bold** text.\n";

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves inline link titles", () => {
    const input = '[Roughdraft](./README.md "Local title")\n';

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves image titles", () => {
    const input = '![Alt text](./image.png "Image title")\n';

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves mailto autolinks as mailto URLs", () => {
    const input = "Visit <https://example.com/a?b=c> or <me@example.com>.\n";

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves source-only HTML comments", () => {
    const input = [
      "Before",
      "",
      "<!-- keep this source note -->",
      "",
      "After",
      "",
    ].join("\n");

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves raw details HTML blocks", () => {
    const input = [
      "<details>",
      "<summary>More</summary>",
      "",
      "Hidden **markdown** body.",
      "",
      "</details>",
      "",
    ].join("\n");

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves multi-line indented code blocks after lists", () => {
    const input = [
      "- Item before",
      "",
      "    code block",
      "    second line",
      "",
      "After",
      "",
    ].join("\n");

    expect(richTextRoundTrip(input)).toBe(input);
  });

  it("preserves table cells containing escaped pipes and inline code pipes", () => {
    const input = [
      "| Column | Value |",
      "| --- | --- |",
      "| Escaped | `a | b` and plain a \\| b |",
      "",
    ].join("\n");

    expect(richTextRoundTrip(input)).toBe(input);
  });
});
