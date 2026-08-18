import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { App } from "./App";
import { initDocumentWidth } from "./document-width";
import "./style.css";

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

function applyColorScheme(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
}

applyColorScheme(darkQuery.matches);
darkQuery.addEventListener("change", (event) => {
  applyColorScheme(event.matches);
});

// Reflect the saved document-width preference before the first paint.
initDocumentWidth();

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
