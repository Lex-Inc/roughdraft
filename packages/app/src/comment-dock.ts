/**
 * Below the review-rail breakpoint the comment composer is docked to the bottom
 * of the viewport instead of stacked above the document. The dock floats over
 * the page, so the text a reviewer just highlighted can end up behind it.
 *
 * These helpers work out the smallest scroll that brings the highlight back
 * into the band of document still visible above the dock. Nudging by the
 * minimum keeps the reviewer's place; scrolling to the anchor outright does
 * not.
 */

export const DOCK_CLEARANCE_MARGIN = 16;

interface DockClearanceInput {
  /** Viewport-relative top edge of the highlighted text. */
  anchorTop: number;
  /** Viewport-relative bottom edge of the highlighted text. */
  anchorBottom: number;
  /** Viewport-relative top edge of the floating dock. */
  dockTop: number;
  /** Viewport-relative top edge of the scrollable document region. */
  viewportTop: number;
  margin?: number;
}

/**
 * Returns how far the document should scroll so the anchor clears the dock.
 * Positive scrolls down, negative scrolls up, zero means leave it alone.
 */
export function getDockClearanceScrollDelta({
  anchorTop,
  anchorBottom,
  dockTop,
  viewportTop,
  margin = DOCK_CLEARANCE_MARGIN,
}: DockClearanceInput): number {
  const bandTop = viewportTop + margin;
  const bandBottom = dockTop - margin;

  // A dock taller than the readable area has nothing to reveal.
  if (bandBottom <= bandTop) return 0;

  // Anchors taller than the band can only be pinned to its top edge.
  if (anchorBottom - anchorTop > bandBottom - bandTop) {
    return Math.round(anchorTop - bandTop);
  }

  if (anchorBottom > bandBottom) {
    return Math.round(anchorBottom - bandBottom);
  }

  if (anchorTop < bandTop) {
    return Math.round(anchorTop - bandTop);
  }

  return 0;
}
