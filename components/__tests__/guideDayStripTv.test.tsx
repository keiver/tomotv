/** On TV each day box carries where the focus scroll lands it: still inside the view, flush on the edge it crossed. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Platform, ScrollView } from "react-native";

jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the strip fixes its platform at import.
const { DAY_BOX, GuideDayStrip } = require("@/components/live-tv/guide-day-strip") as typeof import("@/components/live-tv/guide-day-strip");
const { guideDays } = require("@/utils/guide") as typeof import("@/utils/guide");

const NOW = new Date(2026, 9, 24, 20, 0).getTime();
const days = guideDays(NOW).map((startMs) => ({ startMs, hasListings: true }));

async function render() {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<GuideDayStrip days={days} selectedMs={days[0].startMs} nowMs={NOW} onSelect={jest.fn()} />);
  });
  const isBox = (node: TestRenderer.ReactTestInstance) => node.props.isTVSelectable === true;
  const boxes = () => renderer.root.findAll((node) => isBox(node) && !(node.parent && isBox(node.parent)));
  // In view lands in place, before it on the left edge, past it on the right one.
  const offsets = () => renderer.root.findAll((node) => node.props.scrollSnapOffset !== undefined && typeof node.type !== "string").map((node) => node.props.scrollSnapOffset / DAY_BOX);
  return { renderer, boxes, offsets };
}

describe("GuideDayStrip on TV", () => {
  it("snaps by whole boxes, the focus scroll floored to one", async () => {
    const { renderer } = await render();
    const scroll = renderer.root.findByType(ScrollView);
    expect(Number.isInteger(DAY_BOX)).toBe(true);
    expect(scroll.props.snapToInterval).toBe(DAY_BOX);
    expect(scroll.props.snapToAlignment).toBe("item");
  });

  it("lands a box in view where it sits and one past the right edge on that edge", async () => {
    const { boxes, offsets } = await render();
    expect(offsets()).toEqual([0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
    await act(async () => boxes()[4].props.onFocus());
    expect(offsets()).toEqual([0, 0, 1, 2, 3, 3, 3, 3, 3, 3, 3, 3, 3, 3]);
  });

  it("lands one before the left edge on that edge", async () => {
    const { boxes, offsets } = await render();
    await act(async () => boxes()[9].props.onFocus());
    await act(async () => boxes()[5].props.onFocus());
    expect(offsets()).toEqual([0, 0, 0, 0, 0, 0, 1, 2, 3, 3, 3, 3, 3, 3]);
  });
});
