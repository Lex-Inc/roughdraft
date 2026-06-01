import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(dirname, "../../..");

function readPackageJson(relativePath: string): {
  dependencies?: Record<string, string>;
} {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

describe("published package dependencies", () => {
  // Regression test for #109. The root `roughdraft` package ships
  // `@roughdraft/rfm` as raw `dist` (see the `files` whitelist), so rfm's
  // runtime `import`s are resolved from the installed package's node_modules
  // at runtime — nothing bundles them. Any runtime dependency rfm declares
  // must therefore also be declared in the root manifest, otherwise
  // `npm i -g roughdraft` never installs it and the CLI crashes with
  // ERR_MODULE_NOT_FOUND.
  it("declares every @roughdraft/rfm runtime dependency in the root package", () => {
    const rootDeps = readPackageJson("package.json").dependencies ?? {};
    const rfmDeps =
      readPackageJson("packages/rfm/package.json").dependencies ?? {};

    const missing = Object.keys(rfmDeps).filter((dep) => !(dep in rootDeps));

    expect(
      missing,
      `rfm runtime deps missing from root package.json dependencies: ${missing.join(", ")}. ` +
        "Promote them so a global install resolves them (see #109).",
    ).toEqual([]);
  });
});
