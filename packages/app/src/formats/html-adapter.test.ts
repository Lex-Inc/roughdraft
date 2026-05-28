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
