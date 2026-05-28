import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  applyPreferences,
  clampFontSize,
  DEFAULT_PREFERENCES,
  loadPreferences,
  resolveDark,
  savePreferences,
} from "./preferences";

function createMemoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) ?? null) : null),
    setItem: (key, value) => {
      map.set(key, String(value));
    },
    removeItem: (key) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
    key: (index) => Array.from(map.keys())[index] ?? null,
    get length() {
      return map.size;
    },
  } satisfies Storage;
}

function mockMatchMedia(dark: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: dark,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

describe("preferences", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", createMemoryStorage());
    document.documentElement.className = "";
    document.documentElement.removeAttribute("style");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("clampFontSize", () => {
    it("clamps to the 12-22 range and rounds", () => {
      expect(clampFontSize(8)).toBe(12);
      expect(clampFontSize(30)).toBe(22);
      expect(clampFontSize(15.6)).toBe(16);
      expect(clampFontSize(Number.NaN)).toBe(DEFAULT_PREFERENCES.fontSize);
    });
  });

  describe("loadPreferences", () => {
    it("returns defaults when nothing is stored", () => {
      expect(loadPreferences()).toEqual(DEFAULT_PREFERENCES);
    });

    it("round-trips saved preferences", () => {
      savePreferences({
        theme: "warm",
        fontFamily: "serif",
        fontSize: 18,
        width: "wide",
      });
      expect(loadPreferences()).toEqual({
        theme: "warm",
        fontFamily: "serif",
        fontSize: 18,
        width: "wide",
      });
    });

    it("falls back to defaults for invalid stored values", () => {
      localStorage.setItem(
        "roughdraft.preferences",
        JSON.stringify({
          theme: "neon",
          fontFamily: "comic",
          fontSize: 999,
          width: "huge",
        }),
      );
      expect(loadPreferences()).toEqual({
        theme: DEFAULT_PREFERENCES.theme,
        fontFamily: DEFAULT_PREFERENCES.fontFamily,
        fontSize: 22,
        width: DEFAULT_PREFERENCES.width,
      });
    });
  });

  describe("resolveDark", () => {
    it("is deterministic for explicit themes", () => {
      expect(resolveDark("dark")).toBe(true);
      expect(resolveDark("light")).toBe(false);
      expect(resolveDark("warm")).toBe(false);
    });

    it("follows the OS for system", () => {
      mockMatchMedia(true);
      expect(resolveDark("system")).toBe(true);
      mockMatchMedia(false);
      expect(resolveDark("system")).toBe(false);
    });
  });

  describe("applyPreferences", () => {
    it("toggles the dark class and sets font CSS variables", () => {
      applyPreferences({
        theme: "dark",
        fontFamily: "mono",
        fontSize: 20,
        width: "normal",
      });

      const root = document.documentElement;
      expect(root.classList.contains("dark")).toBe(true);
      expect(root.classList.contains("warm")).toBe(false);
      expect(root.classList.contains("editor-wide")).toBe(false);
      expect(root.style.getPropertyValue("--user-editor-font-size")).toBe(
        "20px",
      );
      expect(root.style.getPropertyValue("--editor-font-family")).toContain(
        "monospace",
      );
    });

    it("applies the warm class without dark", () => {
      applyPreferences({
        theme: "warm",
        fontFamily: "sans",
        fontSize: 16,
        width: "normal",
      });

      const root = document.documentElement;
      expect(root.classList.contains("warm")).toBe(true);
      expect(root.classList.contains("dark")).toBe(false);
    });

    it("toggles the editor-wide class for the wide width", () => {
      applyPreferences({
        theme: "light",
        fontFamily: "sans",
        fontSize: 16,
        width: "wide",
      });
      expect(document.documentElement.classList.contains("editor-wide")).toBe(
        true,
      );

      applyPreferences({
        theme: "light",
        fontFamily: "sans",
        fontSize: 16,
        width: "normal",
      });
      expect(document.documentElement.classList.contains("editor-wide")).toBe(
        false,
      );
    });
  });
});
