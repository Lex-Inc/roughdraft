import { Moon, Sun } from "lucide-react";
import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import "./style.css";

const THEME_STORAGE_KEY = "roughdraft.theme";
type ThemePreference = "light" | "dark";

function getStoredThemePreference(): ThemePreference {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

function setStoredThemePreference(theme: ThemePreference) {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures so the visible toggle still works for the page.
  }
}

function applyColorScheme(theme: ThemePreference) {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

function ThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>(getStoredThemePreference);
  const isDark = theme === "dark";

  useEffect(() => {
    applyColorScheme(theme);
    setStoredThemePreference(theme);
  }, [theme]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY) {
        setTheme(event.newValue === "dark" ? "dark" : "light");
      }
    };

    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((currentTheme) => (currentTheme === "dark" ? "light" : "dark"));
  }, []);

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="fixed bottom-4 left-4 z-[9999] h-9 gap-1.5 rounded-full border-[#DCD6CC] bg-white px-3 text-stone-800 shadow-[0_10px_30px_rgba(15,23,42,0.12)] hover:bg-stone-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
    >
      {isDark ? (
        <Sun aria-hidden="true" className="size-3.5" />
      ) : (
        <Moon aria-hidden="true" className="size-3.5" />
      )}
      {isDark ? "Light" : "Dark"}
    </Button>
  );
}

applyColorScheme(getStoredThemePreference());

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider>
      <App />
      <ThemeToggle />
    </TooltipProvider>
  </StrictMode>,
);
