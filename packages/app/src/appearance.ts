export const ROUGHDRAFT_THEME_STORAGE_KEY = "roughdraft.theme";
export const ROUGHDRAFT_TEXT_SIZE_STORAGE_KEY = "roughdraft.textSize";
export const ROUGHDRAFT_EDITOR_WIDTH_STORAGE_KEY = "roughdraft.editorWidth";
export const ROUGHDRAFT_APPEARANCE_CHANGE_EVENT = "roughdraftappearancechange";
const ROUGHDRAFT_THEME_STORAGE_KEY_COMPAT = "roughdraftTheme";
const ROUGHDRAFT_THEME_STORAGE_KEY_LEGACY = "roughdraft.colorScheme";

export type RoughdraftThemePreference =
  | "system"
  | "quiet-light"
  | "light-plus"
  | "quiet-dark"
  | "dark-plus";

export type ResolvedRoughdraftTheme = Exclude<
  RoughdraftThemePreference,
  "system"
>;

export type RoughdraftTextSize = "small" | "standard" | "large" | "x-large";
export type RoughdraftEditorWidth = "narrow" | "comfortable" | "wide" | "full";

export const roughdraftThemeOptions = [
  {
    value: "system",
    label: "System",
    swatch: "linear-gradient(135deg, #fffefa 0 50%, #263029 50% 100%)",
  },
  {
    value: "quiet-light",
    label: "Quiet Light",
    swatch: "#fffefa",
  },
  {
    value: "light-plus",
    label: "Light+",
    swatch: "#fdfbf6",
  },
  {
    value: "quiet-dark",
    label: "Quiet Dark",
    swatch: "#263029",
  },
  {
    value: "dark-plus",
    label: "Dark+",
    swatch: "#242b31",
  },
] satisfies Array<{
  value: RoughdraftThemePreference;
  label: string;
  swatch: string;
}>;

export const roughdraftTextSizeOptions = [
  {
    value: "small",
    label: "14 px",
    editorFontSize: "14px",
    codeFontSize: "0.85rem",
  },
  {
    value: "standard",
    label: "16 px",
    editorFontSize: "16px",
    codeFontSize: "0.95rem",
  },
  {
    value: "large",
    label: "18 px",
    editorFontSize: "18px",
    codeFontSize: "1.05rem",
  },
  {
    value: "x-large",
    label: "20 px",
    editorFontSize: "20px",
    codeFontSize: "1.15rem",
  },
] satisfies Array<{
  value: RoughdraftTextSize;
  label: string;
  editorFontSize: string;
  codeFontSize: string;
}>;

export const roughdraftEditorWidthOptions = [
  {
    value: "narrow",
    label: "Narrow",
    documentMaxWidth: "38rem",
    workspaceMaxWidth: "64rem",
  },
  {
    value: "comfortable",
    label: "Comfort",
    documentMaxWidth: "46.5rem",
    workspaceMaxWidth: "1080px",
  },
  {
    value: "wide",
    label: "Wide",
    documentMaxWidth: "56rem",
    workspaceMaxWidth: "86rem",
  },
  {
    value: "full",
    label: "Full",
    documentMaxWidth: "68rem",
    workspaceMaxWidth: "104rem",
  },
] satisfies Array<{
  value: RoughdraftEditorWidth;
  label: string;
  documentMaxWidth: string;
  workspaceMaxWidth: string;
}>;

const darkThemes = new Set<ResolvedRoughdraftTheme>([
  "quiet-dark",
  "dark-plus",
]);

function getLocalStorage() {
  if (typeof window === "undefined") return null;

  try {
    const localStorage = window.localStorage;

    if (
      !localStorage ||
      typeof localStorage.getItem !== "function" ||
      typeof localStorage.setItem !== "function"
    ) {
      return null;
    }

    return localStorage;
  } catch {
    return null;
  }
}

function getSystemPrefersDark() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function normalizeRoughdraftThemePreference(
  value: string | null | undefined,
): RoughdraftThemePreference {
  return roughdraftThemeOptions.some((option) => option.value === value)
    ? (value as RoughdraftThemePreference)
    : "system";
}

export function normalizeRoughdraftTextSize(
  value: string | null | undefined,
): RoughdraftTextSize {
  return roughdraftTextSizeOptions.some((option) => option.value === value)
    ? (value as RoughdraftTextSize)
    : "standard";
}

export function normalizeRoughdraftEditorWidth(
  value: string | null | undefined,
): RoughdraftEditorWidth {
  return roughdraftEditorWidthOptions.some((option) => option.value === value)
    ? (value as RoughdraftEditorWidth)
    : "comfortable";
}

export function getStoredRoughdraftThemePreference() {
  const localStorage = getLocalStorage();

  return normalizeRoughdraftThemePreference(
    localStorage?.getItem(ROUGHDRAFT_THEME_STORAGE_KEY) ??
      localStorage?.getItem(ROUGHDRAFT_THEME_STORAGE_KEY_COMPAT) ??
      localStorage?.getItem(ROUGHDRAFT_THEME_STORAGE_KEY_LEGACY),
  );
}

export function getStoredRoughdraftTextSize() {
  return normalizeRoughdraftTextSize(
    getLocalStorage()?.getItem(ROUGHDRAFT_TEXT_SIZE_STORAGE_KEY),
  );
}

export function getStoredRoughdraftEditorWidth() {
  return normalizeRoughdraftEditorWidth(
    getLocalStorage()?.getItem(ROUGHDRAFT_EDITOR_WIDTH_STORAGE_KEY),
  );
}

export function resolveRoughdraftTheme(
  preference: RoughdraftThemePreference,
  systemPrefersDark = getSystemPrefersDark(),
): ResolvedRoughdraftTheme {
  if (preference !== "system") return preference;
  return systemPrefersDark ? "quiet-dark" : "quiet-light";
}

export function isDarkRoughdraftTheme(theme: ResolvedRoughdraftTheme) {
  return darkThemes.has(theme);
}

export function applyRoughdraftThemePreference(
  preference: RoughdraftThemePreference,
  options: { systemPrefersDark?: boolean } = {},
) {
  if (typeof document === "undefined") {
    return resolveRoughdraftTheme(preference, options.systemPrefersDark);
  }

  const resolved = resolveRoughdraftTheme(
    preference,
    options.systemPrefersDark,
  );
  const isDark = isDarkRoughdraftTheme(resolved);
  const root = document.documentElement;

  root.dataset.rdTheme = resolved;
  root.classList.toggle("dark", isDark);
  root.style.colorScheme = isDark ? "dark" : "light";

  return resolved;
}

export function applyRoughdraftTextSize(size: RoughdraftTextSize) {
  const normalizedSize = normalizeRoughdraftTextSize(size);
  const option =
    roughdraftTextSizeOptions.find((entry) => entry.value === normalizedSize) ??
    roughdraftTextSizeOptions[1];

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.rdTextSize = option.value;
    root.style.setProperty("--rd-editor-font-size", option.editorFontSize);
    root.style.setProperty("--rd-code-editor-font-size", option.codeFontSize);
  }

  return option;
}

export function applyRoughdraftEditorWidth(width: RoughdraftEditorWidth) {
  const normalizedWidth = normalizeRoughdraftEditorWidth(width);
  const option =
    roughdraftEditorWidthOptions.find(
      (entry) => entry.value === normalizedWidth,
    ) ?? roughdraftEditorWidthOptions[1];

  if (typeof document !== "undefined") {
    const root = document.documentElement;
    root.dataset.rdEditorWidth = option.value;
    root.style.setProperty("--rd-document-max-width", option.documentMaxWidth);
    root.style.setProperty(
      "--rd-workspace-max-width",
      option.workspaceMaxWidth,
    );
  }

  return option;
}

function emitAppearanceChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(ROUGHDRAFT_APPEARANCE_CHANGE_EVENT));
}

export function setStoredRoughdraftThemePreference(
  preference: RoughdraftThemePreference,
) {
  const normalized = normalizeRoughdraftThemePreference(preference);
  getLocalStorage()?.setItem(ROUGHDRAFT_THEME_STORAGE_KEY, normalized);
  const resolved = applyRoughdraftThemePreference(normalized);
  emitAppearanceChange();
  return resolved;
}

export function setStoredRoughdraftTextSize(size: RoughdraftTextSize) {
  const normalized = normalizeRoughdraftTextSize(size);
  getLocalStorage()?.setItem(ROUGHDRAFT_TEXT_SIZE_STORAGE_KEY, normalized);
  const option = applyRoughdraftTextSize(normalized);
  emitAppearanceChange();
  return option;
}

export function setStoredRoughdraftEditorWidth(width: RoughdraftEditorWidth) {
  const normalized = normalizeRoughdraftEditorWidth(width);
  getLocalStorage()?.setItem(ROUGHDRAFT_EDITOR_WIDTH_STORAGE_KEY, normalized);
  const option = applyRoughdraftEditorWidth(normalized);
  emitAppearanceChange();
  return option;
}

export function applyStoredRoughdraftAppearance() {
  applyRoughdraftThemePreference(getStoredRoughdraftThemePreference());
  applyRoughdraftTextSize(getStoredRoughdraftTextSize());
  applyRoughdraftEditorWidth(getStoredRoughdraftEditorWidth());
}

export function subscribeToRoughdraftAppearance(listener: () => void) {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (
      event.key === ROUGHDRAFT_THEME_STORAGE_KEY ||
      event.key === ROUGHDRAFT_TEXT_SIZE_STORAGE_KEY ||
      event.key === ROUGHDRAFT_EDITOR_WIDTH_STORAGE_KEY
    ) {
      applyStoredRoughdraftAppearance();
      listener();
    }
  };

  window.addEventListener(ROUGHDRAFT_APPEARANCE_CHANGE_EVENT, listener);
  window.addEventListener("storage", handleStorage);

  return () => {
    window.removeEventListener(ROUGHDRAFT_APPEARANCE_CHANGE_EVENT, listener);
    window.removeEventListener("storage", handleStorage);
  };
}

export function installRoughdraftAppearanceSync() {
  applyStoredRoughdraftAppearance();

  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }

  const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const handleSystemThemeChange = () => {
    if (getStoredRoughdraftThemePreference() === "system") {
      applyRoughdraftThemePreference("system");
    }
  };

  darkQuery.addEventListener("change", handleSystemThemeChange);

  return () => {
    darkQuery.removeEventListener("change", handleSystemThemeChange);
  };
}
