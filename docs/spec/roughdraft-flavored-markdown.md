# Roughdraft Flavored Markdown 0.2

Status: Draft

Roughdraft Flavored Markdown is regular Markdown plus a portable review layer based on CriticMarkup. Its purpose is to let people and coding agents exchange comments, threaded replies, and pending changes inside the Markdown file itself.

The key words "MUST", "MUST NOT", "SHOULD", "SHOULD NOT", and "MAY" in this document are to be interpreted as described in RFC 2119.

## Scope

This specification defines the review markup that Roughdraft reads and writes. It does not define a replacement for Markdown, a hosted document format, a sync protocol, or a project database.

A conforming document is a Markdown document that may contain Roughdraft review spans. Markdown parsing SHOULD follow CommonMark with GitHub Flavored Markdown extensions. Implementations MAY preserve YAML frontmatter as document metadata. Roughdraft review state lives in the same Markdown file, either as inline review anchors or as final YAML endmatter.

## Canonical Markers

Roughdraft uses these CriticMarkup-compatible markers:

```markdown
{>>comment<<}
{++inserted text++}
{--deleted text--}
{~~old text~>new text~~}
{==highlighted text==}
```

An implementation MUST treat the opening and closing marker pairs as review delimiters outside inline code and fenced code blocks.

Implementations MUST treat review markers inside inline code spans and fenced code blocks as literal example text. They MUST NOT create comments, suggestions, or highlights from those code contexts.

## Comments

A comment is written as:

```ebnf
comment = "{>>" comment-text "<<}" [ metadata ]
```

Comment text is plain inline Markdown content. Comment text MUST NOT contain the literal closing delimiter `<<}` unless the implementation defines an escaping extension. Writers that do not implement escaping MUST reject comment or reply text containing raw CriticMarkup close delimiters instead of emitting ambiguous review markup.

A comment MAY appear by itself when the feedback applies to the surrounding paragraph or document:

```markdown
Add one concrete launch example here.{>>This should come from the customer story.<<}{#c1}

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
```

## Anchored Comments

An anchored comment is a highlight immediately followed by one or more comment blocks:

```ebnf
anchored-comment = highlight 1*comment
highlight        = "{==" anchor-text "==}"
```

Example:

```markdown
Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
```

The highlighted text is the visible anchor. Implementations SHOULD attach all immediately following comment blocks to the same anchor until another token interrupts the sequence.

A standalone highlight is valid CriticMarkup. Roughdraft 0.1 reserves it as review syntax, but standalone highlights are not required to produce a review-thread item unless an implementation explicitly supports highlight-only annotations.

## Suggestions

Suggestions represent pending edits. Implementations MUST NOT silently collapse suggestions into normal prose while reading or writing Roughdraft Flavored Markdown.

### Insertion

```ebnf
addition = "{++" new-text "++}" [ metadata ] *comment
```

```markdown
Add {++one concrete example++}{#s1}.

---
suggestions:
  s1:
    by: AI
    at: "2026-04-28T12:05:00.000Z"
```

### Deletion

```ebnf
deletion = "{--" old-text "--}" [ metadata ] *comment
```

```markdown
Remove {--vague phrasing--}{#s2}.

---
suggestions:
  s2:
    by: user
    at: "2026-04-28T12:06:00.000Z"
```

### Substitution

```ebnf
substitution = "{~~" old-text "~>" new-text "~~}" [ metadata ] *comment
```

```markdown
Use {~~rough~>specific~~}{#s3} wording.

---
suggestions:
  s3:
    by: AI
    at: "2026-04-28T12:07:00.000Z"
```

Trailing comment blocks after a suggestion attach discussion to that suggestion:

```markdown
Add {++one concrete example++}{#s1}.

---
comments:
  c2:
    body: Use the launch story.
    by: user
    at: "2026-04-28T12:08:00.000Z"
    re: s1
suggestions:
  s1:
    by: AI
    at: "2026-04-28T12:05:00.000Z"
```

## Metadata

Roughdraft's preferred metadata format is a compact inline reference backed by final YAML endmatter:

```ebnf
reference = "{#" id "}"
id        = ALPHA *( ALPHA / DIGIT / "_" / "-" )
```

```markdown
Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
```

Root comment bodies and suggestion text stay inline so their anchors remain portable. Replies live entirely in endmatter because their `re` field already points at a parent id:

```markdown
Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
  c2:
    body: I can add one from the intro.
    by: AI
    at: "2026-04-28T12:05:00.000Z"
    re: c1
```

Suggested-change metadata lives under `suggestions:`:

```markdown
Add {++one concrete example++}{#s1}.

---
suggestions:
  s1:
    by: AI
    at: "2026-04-28T12:05:00.000Z"
```

For compatibility, readers also accept the older inline attribute block written immediately after a comment or suggestion:

```ebnf
metadata  = "{" 1*attribute "}"
attribute = name "=" quoted-value
name      = ALPHA *( ALPHA / DIGIT / "_" / "-" )
```

Attribute values are double-quoted strings. Inside a quoted value, `\"` represents a literal quote and `\\` represents a literal backslash.

Known metadata attributes:

| Attribute | Applies to | Required when writing | Meaning |
| --- | --- | --- | --- |
| `id` | Comments and suggestions | Yes | Stable document-local identifier. |
| `by` | Comments and suggestions | Yes | Author or agent label. `AI` identifies an agent author. |
| `at` | Comments and suggestions | Yes | ISO 8601 timestamp. |
| `re` | Comments | No | Parent comment or suggestion id for threaded replies. |
| `status` | Comments and suggestions | No | Review state. Roughdraft currently writes `resolved` when an item has been addressed. |
| `resolved` | Comments and suggestions | No | Optional short resolution summary for an item whose `status` is `resolved`. |
| `reaction` | Comments | No | Reviewer reaction to a comment. One of `up`, `down`, or `clarify`. Applies to comments and replies only, never to suggestions (which carry Accept/Reject semantics instead). Readers MUST ignore an unknown reaction value rather than reject the document. |

Example:

```markdown
{>>Needs a source.<<}{#c1}

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
    reaction: up
```

The inline equivalent is `{>>Needs a source.<<}{id="c1" by="user" at="2026-04-28T12:00:00.000Z" reaction="up"}`.

Implementations SHOULD generate simple document-local ids. Roughdraft uses `c1`, `c2`, and so on for comments and `s1`, `s2`, and so on for suggestions. Implementations MUST preserve unknown valid attributes or YAML keys when possible, but they MUST NOT require unknown metadata for correct review rendering.

For compatibility, readers MAY accept legacy comment metadata of the form `{@id:c1; by:AI; at:2026-04-28T12:00:00.000Z@}`. Writers SHOULD emit compact references plus YAML endmatter for new review data.

## Threads

Threading is represented by `re`.

```markdown
Review {==this sentence==}{>>Needs a source.<<}{#c1}.

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
  c2:
    body: I can add one from the intro.
    by: AI
    at: "2026-04-28T12:05:00.000Z"
    re: c1
```

A reply whose `re` points to a missing id SHOULD be treated as a top-level comment. A comment MUST NOT be its own parent.

## Parsing And Round Trips

Implementations SHOULD parse Roughdraft review markers as inline review annotations without rewriting unrelated Markdown.

Round trips SHOULD preserve:

- YAML frontmatter delimiters and content.
- Local links and image paths.
- Tables and task lists.
- Inline code and fenced code blocks.
- Raw review marker text inside code contexts.
- Metadata values, including escaped quotes and backslashes.

When importing a valid comment or suggestion without metadata, an implementation MAY synthesize missing `id`, `by`, and `at` values on write.

## Review Interchange JSON

The Markdown file is the normative storage format. For APIs, tests, and integrations, implementations MAY expose a review index JSON document that follows [`roughdraft-flavored-markdown.schema.json`](./roughdraft-flavored-markdown.schema.json).

The review index intentionally does not replace a Markdown AST. It indexes Roughdraft review annotations while leaving block parsing to the Markdown implementation.

Example:

```json
{
  "format": "roughdraft-flavored-markdown",
  "version": "0.1",
  "source": {
    "markdown": "Please revisit {==this sentence==}{>>Needs a source.<<}{#c1}.\\n\\n---\\ncomments:\\n  c1:\\n    by: user\\n    at: \"2026-04-28T12:00:00.000Z\"\\n"
  },
  "comments": [
    {
      "id": "c1",
      "body": "Needs a source.",
      "by": "user",
      "at": "2026-04-28T12:00:00.000Z",
      "anchor": {
        "text": "this sentence"
      }
    }
  ],
  "suggestions": []
}
```

Conformance fixtures live in [`fixtures/`](./fixtures/). A parser that claims Roughdraft Flavored Markdown 0.1 support SHOULD pass those examples or document any intentional differences.
