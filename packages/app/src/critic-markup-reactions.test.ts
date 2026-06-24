import { describe, expect, it } from "vitest";
import {
  criticMarkdownToEditorState,
  editorStateToCriticMarkdown,
} from "./critic-markup";

describe("comment reactions round-trip", () => {
  it("parses reaction='up' from inline attribute metadata", () => {
    const markdown =
      'Hello {==world=={>>Nice!<<}{id="c1" by="user" at="2024-01-01T00:00:00.000Z" reaction="up"}\n';

    const { comments } = criticMarkdownToEditorState(markdown);

    expect(comments.get("c1")?.reaction).toBe("up");
  });

  it("parses reaction='down' from inline attribute metadata", () => {
    const markdown =
      'Hello {==world=={>>Needs work<<}{id="c1" by="user" at="2024-01-01T00:00:00.000Z" reaction="down"}\n';

    const { comments } = criticMarkdownToEditorState(markdown);

    expect(comments.get("c1")?.reaction).toBe("down");
  });

  it("parses reaction='clarify' from inline attribute metadata", () => {
    const markdown =
      'Hello {==world=={>>What?<<}{id="c1" by="user" at="2024-01-01T00:00:00.000Z" reaction="clarify"}\n';

    const { comments } = criticMarkdownToEditorState(markdown);

    expect(comments.get("c1")?.reaction).toBe("clarify");
  });

  it("parses null when reaction attribute is absent", () => {
    const markdown =
      'Hello {==world=={>>Comment<<}{id="c1" by="user" at="2024-01-01T00:00:00.000Z"}\n';

    const { comments } = criticMarkdownToEditorState(markdown);

    expect(comments.get("c1")?.reaction).toBeNull();
  });

  it("serializes reaction='up' back into inline metadata", () => {
    const markdown =
      'Hello {==world=={>>Nice!<<}{id="c1" by="user" at="2024-01-01T00:00:00.000Z" reaction="up"}\n';

    const { doc, comments } = criticMarkdownToEditorState(markdown);
    const serialized = editorStateToCriticMarkdown(doc, comments);

    expect(serialized).toContain('reaction="up"');
  });

  it("serializes reaction='down' back into inline metadata", () => {
    const markdown =
      'Hello {==world=={>>Needs work<<}{id="c1" by="user" at="2024-01-01T00:00:00.000Z" reaction="down"}\n';

    const { doc, comments } = criticMarkdownToEditorState(markdown);
    const serialized = editorStateToCriticMarkdown(doc, comments);

    expect(serialized).toContain('reaction="down"');
  });

  it("omits reaction key when reaction is null", () => {
    const markdown =
      'Hello {==world=={>>Comment<<}{id="c1" by="user" at="2024-01-01T00:00:00.000Z"}\n';

    const { doc, comments } = criticMarkdownToEditorState(markdown);
    const serialized = editorStateToCriticMarkdown(doc, comments);

    expect(serialized).not.toContain("reaction=");
  });

  it("round-trips reaction through endmatter YAML", () => {
    // Use reference syntax {#c1} so metadata comes entirely from endmatter
    const markdown = [
      "Hello {==world=={>>Nice!<<}{#c1}",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2024-01-01T00:00:00.000Z"',
      "    reaction: up",
      "",
    ].join("\n");

    const { comments } = criticMarkdownToEditorState(markdown);

    expect(comments.get("c1")?.reaction).toBe("up");
  });

  it("serializes reaction into endmatter YAML when endmatter is present", () => {
    // Use reference syntax so the comment is loaded from endmatter
    const markdown = [
      "Hello {==world=={>>Nice!<<}{#c1}",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2024-01-01T00:00:00.000Z"',
      "",
    ].join("\n");

    const { doc, comments } = criticMarkdownToEditorState(markdown);

    // Set reaction on the parsed comment
    const comment = comments.get("c1");
    if (!comment) throw new Error("comment c1 not found");
    comments.set("c1", { ...comment, reaction: "clarify" });

    const serialized = editorStateToCriticMarkdown(doc, comments);

    expect(serialized).toContain("reaction: clarify");
  });

  it("removes reaction from endmatter YAML when set to null", () => {
    const markdown = [
      "Hello {==world=={>>Nice!<<}{#c1}",
      "",
      "---",
      "comments:",
      "  c1:",
      "    by: user",
      '    at: "2024-01-01T00:00:00.000Z"',
      "    reaction: up",
      "",
    ].join("\n");

    const { doc, comments } = criticMarkdownToEditorState(markdown);

    // Clear reaction
    const comment = comments.get("c1");
    if (!comment) throw new Error("comment c1 not found");
    comments.set("c1", { ...comment, reaction: null });

    const serialized = editorStateToCriticMarkdown(doc, comments);

    expect(serialized).not.toContain("reaction:");
  });
});
