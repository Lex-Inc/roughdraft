import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

describe("README", () => {
  it("does not ship unresolved CriticMarkup review artifacts in the intro", () => {
    const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
    const intro = readme.slice(
      0,
      readme.indexOf("Paste this into your coding agent:"),
    );

    expect(intro).not.toMatch(/\{(?:==|>>|\+\+|--|~~)/);
    expect(intro).not.toContain('{id="');
  });
});
