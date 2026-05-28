# 0011: HTML Review Markup

## Context

ADR 0002 establishes CriticMarkup as the review format for Markdown documents — comments, suggestions, and threaded metadata live inline in the file. HTML needs an equivalent that satisfies the same constraints: the saved representation is portable, the review state is readable outside Roughdraft, and no sidecar files are required.

## Decision

Roughdraft uses HTML data attributes on native semantic elements as its review markup. Element names match HTML's existing semantics; attribute names mirror CriticMarkup's metadata fields.

| CriticMarkup concept | HTML form |
|---|---|
| Highlight `{==text==}` | `<mark data-rd-id="h1">text</mark>` |
| Insertion `{++text++}` | `<ins data-rd-id="i1" data-rd-by="..." data-rd-at="...">text</ins>` |
| Deletion `{--text--}` | `<del data-rd-id="d1" data-rd-by="..." data-rd-at="...">text</del>` |
| Substitution `{~~old~>new~~}` | `<del data-rd-pair="s1">old</del><ins data-rd-pair="s1">new</ins>` |
| Anchored comment | `<mark data-rd-id="h1">text</mark> … <span data-rd-comment hidden data-rd-id="c1" data-rd-re="h1">comment</span>` |
| Reply | `<span data-rd-comment hidden data-rd-id="c2" data-rd-re="c1">reply</span>` |

Metadata attributes (`data-rd-id`, `data-rd-by`, `data-rd-at`, `data-rd-re`) mirror CriticMarkup's `id`, `by`, `at`, `re` exactly. The id prefix encodes the target type — `h*` for highlights, `c*` for comments, `s*` for suggestions — and is sufficient to disambiguate references without a type attribute.

Comments link to their anchors via `data-rd-re` only. There is no back-link from a highlight to its comments. The reference lives on the dependent side; locating a comment's anchor is direct, and locating a highlight's comments is a scan over the comment set (cheap for the document sizes Roughdraft targets).

Comment spans use the HTML5 `hidden` attribute so the payload stays out of normal browser rendering. The comment rail surfaces hidden spans by reading `[data-rd-comment]` directly from the DOM.

## Consequences

HTML review markup renders sensibly in any browser without Roughdraft. `<ins>`, `<del>`, and `<mark>` carry their native styling; `hidden` comment spans stay invisible until the rail surfaces them. The `rfh` package (Roughdraft Flavored HTML) parses and validates the markup using `linkedom`, mirroring the `rfm` package's role for Markdown. Agents generate ids using the same conventions as CriticMarkup (`c1`, `c2`, …, `s1`, …, `h1`, …) so review history reads consistently across formats.

## What This Explicitly Does Not Mean

The `data-rd-*` namespace is not a general extension point for product features. It carries review state only. Other Roughdraft concerns that need to ride along with HTML content (e.g., future cursor positions, selection state, presence indicators) must use a different namespace. The forward-link-only convention is not a rejection of bidirectional references in principle; it is a recognition that for the document sizes Roughdraft targets, the scan cost is irrelevant and the drift risk of two-place storage is not.
