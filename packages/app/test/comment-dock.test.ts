import { describe, expect, it } from "vitest";
import {
  DOCK_CLEARANCE_MARGIN,
  getDockClearanceScrollDelta,
} from "../src/comment-dock";

/**
 * viewportTop 0, dockTop 700: the readable band is 16..684 with the default
 * 16px margin.
 */
const band = { viewportTop: 0, dockTop: 700 };

describe("getDockClearanceScrollDelta", () => {
  it("leaves the reader alone when the anchor already clears the dock", () => {
    expect(
      getDockClearanceScrollDelta({
        ...band,
        anchorTop: 200,
        anchorBottom: 240,
      }),
    ).toBe(0);
  });

  it("scrolls down by the overlap when the dock covers the anchor", () => {
    expect(
      getDockClearanceScrollDelta({
        ...band,
        anchorTop: 660,
        anchorBottom: 740,
      }),
    ).toBe(740 - (700 - DOCK_CLEARANCE_MARGIN));
  });

  it("scrolls up when the anchor sits above the readable area", () => {
    expect(
      getDockClearanceScrollDelta({
        ...band,
        anchorTop: -30,
        anchorBottom: 10,
      }),
    ).toBe(-30 - DOCK_CLEARANCE_MARGIN);
  });

  it("pins an anchor taller than the readable band to the top", () => {
    expect(
      getDockClearanceScrollDelta({
        ...band,
        anchorTop: 120,
        anchorBottom: 1200,
      }),
    ).toBe(120 - DOCK_CLEARANCE_MARGIN);
  });

  it("does nothing when the dock leaves no readable band", () => {
    expect(
      getDockClearanceScrollDelta({
        viewportTop: 0,
        dockTop: 10,
        anchorTop: 400,
        anchorBottom: 440,
      }),
    ).toBe(0);
  });

  it("measures the band from the top of the scrollable region, not the window", () => {
    expect(
      getDockClearanceScrollDelta({
        viewportTop: 120,
        dockTop: 700,
        anchorTop: 100,
        anchorBottom: 150,
      }),
    ).toBe(100 - (120 + DOCK_CLEARANCE_MARGIN));
  });
});
