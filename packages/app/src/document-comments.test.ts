import { describe, expect, it } from "vitest";
import { criticMarkdownToRenderedHtml } from "./critic-markup";
import {
  buildCommentThreadRailItems,
  type CommentGroupAnchor,
} from "./document-comments";

const DOCUMENT_WITH_ENDMATTER_REPLY = `# Draft

{==anchored text==}{>>Original comment.<<}{#c1}

---
comments:
  c1:
    by: user
    at: "2026-04-28T12:00:00.000Z"
  c2:
    body: A reply that lives only in the endmatter.
    by: AI
    at: "2026-04-28T12:05:00.000Z"
    re: c1
`;

function anchorGroupFor(commentIds: string[]): CommentGroupAnchor {
  return {
    key: commentIds.join(","),
    commentIds,
    anchorTop: 0,
    anchorBottom: 20,
  };
}

describe("buildCommentThreadRailItems", () => {
  it("renders a reply that exists only in the YAML endmatter", () => {
    const { comments } = criticMarkdownToRenderedHtml(
      DOCUMENT_WITH_ENDMATTER_REPLY,
    );

    // The anchor only knows about the inline marker, which is exactly the
    // situation the app writes itself when replying through the rail.
    const items = buildCommentThreadRailItems(
      [anchorGroupFor(["c1"])],
      comments,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.rootCommentId).toBe("c1");
    expect(items[0]?.commentIds).toEqual(["c1", "c2"]);
  });

  it("does not duplicate a reply that is already anchored inline", () => {
    const { comments } = criticMarkdownToRenderedHtml(
      DOCUMENT_WITH_ENDMATTER_REPLY,
    );

    const items = buildCommentThreadRailItems(
      [anchorGroupFor(["c1", "c2"])],
      comments,
    );

    expect(items).toHaveLength(1);
    expect(items[0]?.commentIds).toEqual(["c1", "c2"]);
  });
});
