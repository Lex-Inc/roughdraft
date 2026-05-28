# 0012: HTML View Modes And CSS Scoping

## Context

HTML documents arrive with their own embedded `<style>` blocks — design system tokens, layout rules, custom typography. Roughdraft has its own UI styling. Without isolation the two stylesheet sets collide, and document tokens leak into the chrome or vice versa. Separately, the visual fidelity of HTML is a primary reason authors choose it over Markdown; the review interface must let authors check that fidelity without leaving the tool.

## Decision

The HTML adapter exposes two view modes, one comment-visibility toggle, and one escape hatch for full-viewport fidelity.

**View modes** (selected via `editorViewMode` in `PageCard.tsx`):
- **Document mode** — Tiptap renders the document body inside `<div class="rd-doc-content">`. The document's `<style>` block is applied via CSS `@scope (.rd-doc-content)` so its tokens stay inside the content area and never reach Roughdraft chrome.
- **Source mode** — CodeMirror shows the raw HTML text for diffing, debugging, and copy-paste.

**Show/Hide Comments toggle** (within Document mode):
- ON (default) — comment rail visible, inline marks styled with full review treatment.
- OFF — comment rail slides away via an animated transition on `grid-template-columns` (~200ms), inline marks fade via a body-level `.rd-marks-hidden` class, and the document column expands to ~1080px so the document's own layout has room to breathe. Markdown documents reuse the same toggle but keep their column at ~744px to preserve line length.

The toggle is a single button, not a split control. Fine-grained separation (rail-only vs. marks-only) is deferred until users explicitly ask. The toggle state persists across documents as a user preference.

**Open in new tab** (small icon button, not a mode):
- Opens `/preview?path=...` in a fresh browser tab with zero Roughdraft chrome.
- The preview tab subscribes to the existing SSE file-change stream and re-renders live as the user edits in the main tab.

For browsers without `@scope` support, the HTML adapter falls back to a Shadow DOM wrapper around the document content. Coverage of `@scope` is sufficient (~92% as of 2026-05) that the fallback is the exception.

## Consequences

The document's design system survives intact. Authors who chose HTML for visual fidelity keep their tokens, fonts, and layout exactly as the recipient will see them. Roughdraft's chrome is not subject to the document's CSS; UI components remain stable regardless of the document's styling. The Show/Hide Comments toggle reuses the existing `document-page-shell-no-comments` class in `DocumentWorkspace.tsx`, so the work is ~20 lines of UI plumbing rather than a new rendering pipeline. The new-tab preview is a small additional server route that reuses the existing SSE machinery.

## What This Explicitly Does Not Mean

Roughdraft does not become a general-purpose HTML viewer, an iframe sandbox, or a browser-in-a-browser. The `@scope` mechanism is a styling boundary, not a security boundary — Roughdraft trusts the document author. Scripts inside the document are excluded as they are today (Tiptap strips them on parse). Embedded media (images, fonts via `@font-face`) load as written.
