import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ResolvedRoughdraftTheme } from "../src/appearance";
import { roughdraftThemeOptions } from "../src/appearance";

const stylePath = join(process.cwd(), "src/style.css");
const styleCss = readFileSync(stylePath, "utf8");

type Rgb = [number, number, number];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCssBlock(selector: string, required = true) {
  const blockMatch = styleCss.match(
    new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`),
  );
  if (required) expect(blockMatch?.[1]).toBeDefined();
  return blockMatch?.[1] ?? "";
}

function extractVariables(selector: string, required = true) {
  const block = extractCssBlock(selector, required);
  const variables = new Map<string, string>();
  const variablePattern = /--([a-z0-9-]+):\s*([^;]+);/gi;

  for (const match of block.matchAll(variablePattern)) {
    variables.set(match[1], match[2].trim());
  }

  return variables;
}

const themeSelectors = {
  "quiet-light": [":root", ':root[data-rd-theme="quiet-light"]'],
  "light-plus": [":root", ':root[data-rd-theme="light-plus"]'],
  "quiet-dark": [":root", ".dark", ':root[data-rd-theme="quiet-dark"]'],
  "dark-plus": [":root", ".dark", ':root[data-rd-theme="dark-plus"]'],
} satisfies Record<ResolvedRoughdraftTheme, string[]>;

const requiredThemeSelectors = new Set([
  ":root",
  ".dark",
  ':root[data-rd-theme="light-plus"]',
  ':root[data-rd-theme="dark-plus"]',
]);

function extractThemeVariables(theme: ResolvedRoughdraftTheme) {
  const variables = new Map<string, string>();

  for (const selector of themeSelectors[theme]) {
    for (const [key, value] of extractVariables(
      selector,
      requiredThemeSelectors.has(selector),
    )) {
      variables.set(key, value);
    }
  }

  return variables;
}

function parseHexColor(value: string): Rgb {
  const normalized = value.trim();
  expect(normalized).toMatch(/^#[0-9a-f]{6}$/i);

  return [
    Number.parseInt(normalized.slice(1, 3), 16),
    Number.parseInt(normalized.slice(3, 5), 16),
    Number.parseInt(normalized.slice(5, 7), 16),
  ];
}

function relativeLuminance(rgb: Rgb) {
  const [red, green, blue] = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(left: Rgb, right: Rgb) {
  const leftLuminance = relativeLuminance(left);
  const rightLuminance = relativeLuminance(right);
  const lighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function channelSpread(rgb: Rgb) {
  return Math.max(...rgb) - Math.min(...rgb);
}

describe("Roughdraft theme tokens", () => {
  const selectableThemes = roughdraftThemeOptions
    .map((option) => option.value)
    .filter((theme): theme is ResolvedRoughdraftTheme => theme !== "system");

  it("keeps document surfaces readable in every selectable theme", () => {
    for (const theme of selectableThemes) {
      const variables = extractThemeVariables(theme);
      const appBackground = parseHexColor(
        variables.get("rd-app-background") ?? "",
      );
      const appForeground = parseHexColor(
        variables.get("rd-app-foreground") ?? "",
      );
      const editorBackground = parseHexColor(
        variables.get("rd-editor-background") ?? "",
      );
      const editorForeground = parseHexColor(
        variables.get("rd-editor-foreground") ?? "",
      );

      expect(contrastRatio(appBackground, appForeground)).toBeGreaterThan(7);
      expect(contrastRatio(editorBackground, editorForeground)).toBeGreaterThan(
        7,
      );
    }
  });

  it("avoids pure black or pure white as app surfaces", () => {
    for (const theme of selectableThemes) {
      const variables = extractThemeVariables(theme);

      for (const token of [
        "rd-app-background",
        "rd-editor-background",
        "rd-surface",
        "rd-surface-elevated",
        "rd-menu-background",
      ]) {
        expect(variables.get(token)?.toLowerCase()).not.toBe("#000000");
        expect(variables.get(token)?.toLowerCase()).not.toBe("#ffffff");
      }
    }
  });

  it("uses tinted foundations instead of flat gray-only backgrounds", () => {
    for (const theme of selectableThemes) {
      const variables = extractThemeVariables(theme);

      for (const token of ["rd-app-background", "rd-editor-background"]) {
        expect(
          channelSpread(parseHexColor(variables.get(token) ?? "")),
        ).toBeGreaterThanOrEqual(4);
      }
    }
  });
});
