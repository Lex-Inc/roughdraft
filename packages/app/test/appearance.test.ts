import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ROUGHDRAFT_EDITOR_WIDTH_STORAGE_KEY,
  ROUGHDRAFT_TEXT_SIZE_STORAGE_KEY,
  ROUGHDRAFT_THEME_STORAGE_KEY,
  applyRoughdraftThemePreference,
  getStoredRoughdraftEditorWidth,
  getStoredRoughdraftTextSize,
  getStoredRoughdraftThemePreference,
  setStoredRoughdraftEditorWidth,
  setStoredRoughdraftTextSize,
  setStoredRoughdraftThemePreference,
} from "../src/appearance";

function installLocalStorageMock() {
  const store = new Map<string, string>();
  const localStorageMock = {
    clear: vi.fn(() => store.clear()),
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    removeItem: vi.fn((key: string) => store.delete(key)),
    setItem: vi.fn((key: string, value: string) => {
      store.set(key, value);
    }),
  };

  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: localStorageMock,
  });
}

describe("Roughdraft appearance preferences", () => {
  beforeEach(() => {
    installLocalStorageMock();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
    document.documentElement.removeAttribute("data-rd-editor-width");
    document.documentElement.removeAttribute("data-rd-theme");
    document.documentElement.removeAttribute("data-rd-text-size");
    document.documentElement.removeAttribute("style");
    vi.restoreAllMocks();
  });

  it("persists and applies a selected dark editor theme", () => {
    const resolvedTheme = setStoredRoughdraftThemePreference("dark-plus");

    expect(resolvedTheme).toBe("dark-plus");
    expect(localStorage.getItem(ROUGHDRAFT_THEME_STORAGE_KEY)).toBe(
      "dark-plus",
    );
    expect(getStoredRoughdraftThemePreference()).toBe("dark-plus");
    expect(document.documentElement.dataset.rdTheme).toBe("dark-plus");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe("dark");
  });

  it("resolves system theme choices from the OS color scheme", () => {
    expect(
      applyRoughdraftThemePreference("system", { systemPrefersDark: false }),
    ).toBe("quiet-light");
    expect(document.documentElement.dataset.rdTheme).toBe("quiet-light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);

    expect(
      applyRoughdraftThemePreference("system", { systemPrefersDark: true }),
    ).toBe("quiet-dark");
    expect(document.documentElement.dataset.rdTheme).toBe("quiet-dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("persists and applies editor text size choices", () => {
    const option = setStoredRoughdraftTextSize("large");

    expect(option.label).toBe("18 px");
    expect(localStorage.getItem(ROUGHDRAFT_TEXT_SIZE_STORAGE_KEY)).toBe(
      "large",
    );
    expect(getStoredRoughdraftTextSize()).toBe("large");
    expect(document.documentElement.dataset.rdTextSize).toBe("large");
    expect(
      document.documentElement.style.getPropertyValue("--rd-editor-font-size"),
    ).toBe("18px");
    expect(
      document.documentElement.style.getPropertyValue(
        "--rd-code-editor-font-size",
      ),
    ).toBe("1.05rem");
  });

  it("persists and applies editor width choices", () => {
    const option = setStoredRoughdraftEditorWidth("wide");

    expect(option.label).toBe("Wide");
    expect(localStorage.getItem(ROUGHDRAFT_EDITOR_WIDTH_STORAGE_KEY)).toBe(
      "wide",
    );
    expect(getStoredRoughdraftEditorWidth()).toBe("wide");
    expect(document.documentElement.dataset.rdEditorWidth).toBe("wide");
    expect(
      document.documentElement.style.getPropertyValue(
        "--rd-document-max-width",
      ),
    ).toBe("56rem");
    expect(
      document.documentElement.style.getPropertyValue(
        "--rd-workspace-max-width",
      ),
    ).toBe("86rem");
  });
});
