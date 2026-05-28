# 0010: Multi-Format Document Support

## Context

Roughdraft was built around Markdown as its sole document format. Authors increasingly produce HTML for human-facing deliverables, where embedded styling and visual hierarchy reduce cognitive load on recipients. The review workflow — open, comment, agent integration, save, close — is fundamentally format-agnostic. Only parsing, serialization, and review-markup extraction need to differ between formats.

## Decision

Roughdraft introduces a `FormatAdapter` interface. Each adapter encapsulates parsing on-disk bytes into editor state, serializing editor state back to bytes, validating review markup, extracting a `ReviewIndex`, appending replies, marking items resolved, and extracting the document title. The existing Markdown logic becomes the first concrete adapter, extracted from `markdown.ts` and `critic-markup/index.ts` without behavior change. HTML becomes the second adapter, implemented from scratch in a new `formats/html-adapter.ts`.

The CLI, server, MCP tools, comment rail, file watcher, and SSE event model remain format-agnostic. Dispatch to the active adapter happens by file extension. Recognized synonyms: `.md` and `.markdown` route to the Markdown adapter; `.html` and `.htm` route to the HTML adapter. Unrecognized extensions fail loud with an error suggesting `--as md` or `--as html` for explicit override; Roughdraft does not sniff file contents.

MCP tool names stay unchanged (they were already format-neutral); only their descriptions update to say "document" instead of "markdown." The `ReviewIndex.location` field becomes polymorphic — `{line, column}` for Markdown items, `{domPath, offset}` for HTML items.

## Consequences

The Markdown user experience is preserved exactly. The existing Markdown test suite must pass unchanged after the adapter extraction; any test that breaks indicates the refactor leaked behavior into the wrong layer. New adapters (e.g., AsciiDoc, MDX) can be added in the future by implementing the same interface without touching the rest of the system. Agents that already consume the MCP tools continue to work for both formats without changes.

## What This Explicitly Does Not Mean

This is not a step toward multi-document workspaces, in-place format conversion, or rendering pipelines that mix formats inside one file. Per ADR 0001, each document remains a single file in a single format, opened one at a time. The `FormatAdapter` is an internal implementation seam, not a user-facing concept.
