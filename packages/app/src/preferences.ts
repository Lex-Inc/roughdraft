// User appearance preferences (theme, font family, font size), persisted in
// localStorage and applied as classes / CSS custom properties on <html>.

export type Theme = "light" | "warm" | "dark" | "system";
export type FontFamily = "sans" | "serif" | "mono";
export type EditorWidth = "normal" | "wide";

export interface Preferences {
  theme: Theme;
  fontFamily: FontFamily;
  fontSize: number;
  width: EditorWidth;
}

export const MIN_FONT_SIZE = 12;
export const MAX_FONT_SIZE = 22;

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "system",
  fontFamily: "sans",
  fontSize: 16,
  width: "normal",
};

const STORAGE_KEY = "roughdraft.preferences";

const FONT_FAMILY_STACKS: Record<FontFamily, string> = {
  sans: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
  serif: 'Georgia, Cambria, "Times New Roman", ui-serif, serif',
  mono: 'ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace',
};

export const FONT_FAMILY_LABELS: Record<FontFamily, string> = {
  sans: "Sans",
  serif: "Serif",
  mono: "Mono",
};

export const THEME_LABELS: Record<Theme, string> = {
  light: "Light",
  warm: "Warm",
  dark: "Dark",
  system: "System",
};

export const EDITOR_WIDTH_LABELS: Record<EditorWidth, string> = {
  normal: "Normal",
  wide: "Wide",
};

function isTheme(value: unknown): value is Theme {
  return (
    value === "light" ||
    value === "warm" ||
    value === "dark" ||
    value === "system"
  );
}

function isFontFamily(value: unknown): value is FontFamily {
  return value === "sans" || value === "serif" || value === "mono";
}

function isEditorWidth(value: unknown): value is EditorWidth {
  return value === "normal" || value === "wide";
}

export function clampFontSize(size: number): number {
  if (!Number.isFinite(size)) return DEFAULT_PREFERENCES.fontSize;
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)));
}

export function loadPreferences(): Preferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_PREFERENCES };

    const parsed = JSON.parse(raw) as Partial<Preferences>;
    return {
      theme: isTheme(parsed.theme) ? parsed.theme : DEFAULT_PREFERENCES.theme,
      fontFamily: isFontFamily(parsed.fontFamily)
        ? parsed.fontFamily
        : DEFAULT_PREFERENCES.fontFamily,
      fontSize:
        typeof parsed.fontSize === "number"
          ? clampFontSize(parsed.fontSize)
          : DEFAULT_PREFERENCES.fontSize,
      width: isEditorWidth(parsed.width)
        ? parsed.width
        : DEFAULT_PREFERENCES.width,
    };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore storage failures (private mode, disabled storage, etc.).
  }
}

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

/** Resolve whether the dark palette applies for a given theme choice. */
export function resolveDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light" || theme === "warm") return false;
  return prefersDark();
}

/** Apply preferences to the document root (classes + CSS custom properties). */
export function applyPreferences(preferences: Preferences): void {
  const root = document.documentElement;
  root.classList.toggle("dark", resolveDark(preferences.theme));
  root.classList.toggle("warm", preferences.theme === "warm");
  root.classList.toggle("editor-wide", preferences.width === "wide");
  root.style.setProperty(
    "--editor-font-family",
    FONT_FAMILY_STACKS[preferences.fontFamily],
  );
  // Set a dedicated variable rather than --editor-font-size: the editor rules
  // declare --editor-font-size locally (per-context defaults), which would
  // shadow an inherited value. .tiptap reads --user-editor-font-size first.
  root.style.setProperty(
    "--user-editor-font-size",
    `${clampFontSize(preferences.fontSize)}px`,
  );
}
