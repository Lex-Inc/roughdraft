import { useSyncExternalStore } from "react";

/**
 * User preference for how wide the rendered document is.
 *
 * - `comfortable` — the classic centered ~46.5rem reading column.
 * - `wide` — the document fills most of the available width (~5% side gutters),
 *   which gives wide content such as ASCII diagrams room to breathe.
 *
 * The preference is persisted in localStorage and reflected as a
 * `data-doc-width` attribute on the document root, so the layout can switch
 * entirely in CSS (see `.review-layout-grid` / `.review-layout-main`).
 */
export type DocumentWidth = "comfortable" | "wide";

const STORAGE_KEY = "roughdraft:document-width";
const DEFAULT_WIDTH: DocumentWidth = "wide";

export function isDocumentWidth(value: unknown): value is DocumentWidth {
  return value === "comfortable" || value === "wide";
}

export function readStoredDocumentWidth(): DocumentWidth {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return isDocumentWidth(raw) ? raw : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function applyDocumentWidth(width: DocumentWidth): void {
  document.documentElement.dataset.docWidth = width;
}

const listeners = new Set<() => void>();
let current: DocumentWidth | null = null;
let storageListenerAttached = false;

function notify(): void {
  for (const listener of listeners) listener();
}

function ensureStorageListener(): void {
  if (storageListenerAttached || typeof window === "undefined") return;
  storageListenerAttached = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY || !isDocumentWidth(event.newValue)) return;
    current = event.newValue;
    applyDocumentWidth(current);
    notify();
  });
}

export function getDocumentWidth(): DocumentWidth {
  if (current === null) current = readStoredDocumentWidth();
  return current;
}

export function setDocumentWidth(width: DocumentWidth): void {
  current = width;
  try {
    localStorage.setItem(STORAGE_KEY, width);
  } catch {
    // Ignore storage failures (private mode, quota); the in-memory value and
    // applied attribute still take effect for this session.
  }
  applyDocumentWidth(width);
  notify();
}

/**
 * Sync the document root to the stored preference. Call once at startup, before
 * the app renders, to avoid a flash of the wrong width.
 */
export function initDocumentWidth(): DocumentWidth {
  const width = getDocumentWidth();
  applyDocumentWidth(width);
  return width;
}

function subscribe(listener: () => void): () => void {
  ensureStorageListener();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDocumentWidth(): [
  DocumentWidth,
  (width: DocumentWidth) => void,
] {
  const width = useSyncExternalStore(
    subscribe,
    getDocumentWidth,
    getDocumentWidth,
  );
  return [width, setDocumentWidth];
}
