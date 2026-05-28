import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { applyPreferences, loadPreferences } from "./preferences";
import "./style.css";

// Apply saved appearance preferences before first paint to avoid a flash.
applyPreferences(loadPreferences());

// When the theme is "system", follow OS light/dark changes at runtime.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener("change", () => {
  const preferences = loadPreferences();
  if (preferences.theme === "system") {
    applyPreferences(preferences);
  }
});

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Root element #root was not found.");
}

createRoot(rootElement).render(
  <StrictMode>
    <TooltipProvider>
      <App />
    </TooltipProvider>
  </StrictMode>,
);
