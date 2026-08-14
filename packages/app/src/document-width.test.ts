import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "roughdraft:document-width";

// Each test gets a fresh module instance so the module-level cache never leaks
// between cases.
async function loadModule() {
  vi.resetModules();
  return import("./document-width");
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-doc-width");
});

describe("document width preference", () => {
  it("defaults to comfortable when nothing is stored", async () => {
    const { readStoredDocumentWidth } = await loadModule();
    expect(readStoredDocumentWidth()).toBe("comfortable");
  });

  it("reads a stored preference", async () => {
    localStorage.setItem(STORAGE_KEY, "wide");
    const { readStoredDocumentWidth } = await loadModule();
    expect(readStoredDocumentWidth()).toBe("wide");
  });

  it("falls back to the default for an unknown stored value", async () => {
    localStorage.setItem(STORAGE_KEY, "medium");
    const { readStoredDocumentWidth } = await loadModule();
    expect(readStoredDocumentWidth()).toBe("comfortable");
  });

  it("validates width values", async () => {
    const { isDocumentWidth } = await loadModule();
    expect(isDocumentWidth("wide")).toBe(true);
    expect(isDocumentWidth("comfortable")).toBe(true);
    expect(isDocumentWidth("cozy")).toBe(false);
    expect(isDocumentWidth(null)).toBe(false);
  });

  it("reflects the width on the document root", async () => {
    const { applyDocumentWidth } = await loadModule();
    applyDocumentWidth("comfortable");
    expect(document.documentElement.dataset.docWidth).toBe("comfortable");
    applyDocumentWidth("wide");
    expect(document.documentElement.dataset.docWidth).toBe("wide");
  });

  it("persists a new preference and reflects it everywhere", async () => {
    const { setDocumentWidth, getDocumentWidth } = await loadModule();
    setDocumentWidth("comfortable");
    expect(getDocumentWidth()).toBe("comfortable");
    expect(localStorage.getItem(STORAGE_KEY)).toBe("comfortable");
    expect(document.documentElement.dataset.docWidth).toBe("comfortable");
  });

  it("initializes the document root from the stored preference", async () => {
    localStorage.setItem(STORAGE_KEY, "comfortable");
    const { initDocumentWidth } = await loadModule();
    expect(initDocumentWidth()).toBe("comfortable");
    expect(document.documentElement.dataset.docWidth).toBe("comfortable");
  });
});
