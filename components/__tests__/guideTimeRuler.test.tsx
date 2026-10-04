/** The ruler draws the marks inside the span it is handed, however long the window is. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { StyleSheet, Text } from "react-native";

import { GuideTimeRuler } from "@/components/live-tv/guide-time-ruler";
import { guideMetrics, MINUTE_MS, type CanvasSpan } from "@/utils/guide";

const metrics = guideMetrics(true);
const T0 = Date.UTC(2026, 8, 12, 4, 0, 0);
const HOURS = 30;
/** A half hour on the canvas: the distance between two labelled marks. */
const HALF_HOUR_PX = 30 * metrics.pxPerMinute;

function render(mountSpan?: CanvasSpan) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(
      <GuideTimeRuler windowStartMs={T0} windowEndMs={T0 + HOURS * 60 * MINUTE_MS} metrics={metrics} spanPx={HOURS * 2 * HALF_HOUR_PX} nowMs={T0 - MINUTE_MS} mountSpan={mountSpan} />,
    );
  });
  return tree;
}
const labels = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).length;
const hiddenMarks = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => typeof node.type === "string" && StyleSheet.flatten(node.props.style)?.opacity === 0).length;

describe("GuideTimeRuler", () => {
  it("labels every half hour of the window without a span", () => {
    expect(labels(render())).toBe(HOURS * 2);
  });

  it("draws only the span's marks", () => {
    expect(labels(render({ fromPx: 30 * HALF_HOUR_PX, toPx: 40 * HALF_HOUR_PX }))).toBe(11);
  });

  it("hides the window's first mark for the seam, and no span's first mark after it", () => {
    expect(hiddenMarks(render({ fromPx: -HALF_HOUR_PX, toPx: 10 * HALF_HOUR_PX }))).toBe(1);
    expect(hiddenMarks(render({ fromPx: 30 * HALF_HOUR_PX, toPx: 40 * HALF_HOUR_PX }))).toBe(0);
  });
});
