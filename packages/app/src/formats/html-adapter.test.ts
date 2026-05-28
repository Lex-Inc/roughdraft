import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { htmlAdapter } from "./html-adapter";

const fixturesDir = join(__dirname, "fixtures");
const readFixture = (name: string) =>
  readFileSync(join(fixturesDir, name), "utf8");

describe("htmlAdapter — parse", () => {
  it("parses a minimal document into a non-empty editor state", () => {
    const state = htmlAdapter.parse(readFixture("minimal.html"));
    expect(state.doc).toBeDefined();
    expect(state.doc.type).toBe("doc");
    expect(state.comments.size).toBe(0);
    expect(state.frontmatter).not.toBeNull();
  });

  it("extracts structured Tiptap JSON from body content", () => {
    const state = htmlAdapter.parse(readFixture("with-style.html"));
    const content = state.doc.content ?? [];
    const nodeTypes = content.map((n) => n.type);
    expect(nodeTypes).toContain("heading");
    expect(nodeTypes).toContain("paragraph");
    expect(nodeTypes).toContain("bulletList");
  });
});

describe("htmlAdapter — comments", () => {
  it("extracts <span data-rd-comment hidden> elements into the comments map", () => {
    const state = htmlAdapter.parse(readFixture("with-review.html"));
    expect(state.comments.size).toBe(2);
    expect(state.comments.has("c1")).toBe(true);
    expect(state.comments.has("c2")).toBe(true);
    const c1 = state.comments.get("c1");
    expect(c1?.authorType).toBe("ai");
    expect(c1?.authorId).toBe("AI");
    expect(c1?.parentCommentId).toBeNull();
    expect(c1?.content).toContain("strong");
    const c2 = state.comments.get("c2");
    expect(c2?.parentCommentId).toBe("c1");
    expect(c2?.authorType).toBe("user");
  });

  it("removes comment spans from body content before passing to Tiptap", () => {
    const state = htmlAdapter.parse(readFixture("with-review.html"));
    const serialized = JSON.stringify(state.doc);
    expect(serialized).not.toContain("data-rd-comment");
    expect(serialized).not.toContain("Can we add a number");
  });

  it("preserves comment spans byte-for-byte through serialize round-trip", () => {
    const input = readFixture("with-review.html");
    const output = htmlAdapter.serialize(htmlAdapter.parse(input));
    expect(output).toBe(input);
  });
});

describe("htmlAdapter — extractTitle", () => {
  it("returns the <title> when present", () => {
    expect(htmlAdapter.extractTitle(readFixture("minimal.html"))).toBe(
      "Minimal",
    );
  });

  it("prefers <title> over <h1>", () => {
    expect(htmlAdapter.extractTitle(readFixture("with-style.html"))).toBe(
      "Styled Document",
    );
  });

  it("falls back to first <h1> when <title> is missing", () => {
    const html =
      '<!doctype html><html><head></head><body><h1>From H1</h1></body></html>';
    expect(htmlAdapter.extractTitle(html)).toBe("From H1");
  });

  it("returns null when neither <title> nor <h1> exists", () => {
    const html = "<!doctype html><html><head></head><body><p>x</p></body></html>";
    expect(htmlAdapter.extractTitle(html)).toBeNull();
  });
});

describe("htmlAdapter — round-trip", () => {
  it("serialize(parse(roundtrip-pristine.html)) returns the input byte-for-byte", () => {
    const input = readFixture("roundtrip-pristine.html");
    const output = htmlAdapter.serialize(htmlAdapter.parse(input));
    expect(output).toBe(input);
  });

  it("preserves <!doctype>, <meta>, <title>, and <style> in preamble byte-for-byte", () => {
    const input = readFixture("with-style.html");
    const output = htmlAdapter.serialize(htmlAdapter.parse(input));
    expect(output).toBe(input);
  });
});
