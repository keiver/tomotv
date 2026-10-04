/** The day strip over the channel column: one circle per day, the pick first, listings told by dimming, a press picks. */
import { DAY_CIRCLE, DAY_GAP, DAY_INSET, GuideDayStrip } from "@/components/live-tv/guide-day-strip";
import { COLORS } from "@/constants/colors";
import { dayStripVisibleCount, guideDays } from "@/utils/guide";
import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

// A Saturday at 20:00 local; the strip's second week crosses into the next month.
const NOW = new Date(2026, 9, 24, 20, 0).getTime();
const days = guideDays(NOW).map((startMs, i) => ({ startMs, hasListings: i < 7 ? true : i < 10 ? false : null }));

async function render(selectedMs = days[0].startMs) {
  const onSelect = jest.fn();
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<GuideDayStrip days={days} selectedMs={selectedMs} nowMs={NOW} onSelect={onSelect} />);
  });
  const isCircle = (node: TestRenderer.ReactTestInstance) => node.props.isTVSelectable === true;
  const circles = renderer.root.findAll((node) => isCircle(node) && !(node.parent && isCircle(node.parent)));
  const texts = renderer.root.findAllByType(Text).map((node) => String(node.props.children));
  return { renderer, circles, texts, onSelect };
}

describe("GuideDayStrip", () => {
  it("draws one circle per day, numbered by the day of the month, the month's name on its first day", async () => {
    const { circles, texts } = await render();
    expect(circles).toHaveLength(14);
    expect(texts.slice(1, 9)).toEqual(["24", "25", "26", "27", "28", "29", "30", "31"]);
    expect(texts[9]).toBe(new Date(2026, 10, 1).toLocaleDateString([], { month: "short" }));
    expect(texts[10]).toBe("2");
  });

  it("heads the strip with the picked day and marks it selected", async () => {
    const { circles, texts } = await render(days[1].startMs);
    expect(texts[0]).toBe(`liveTv.tomorrow · ${new Date(days[1].startMs).toLocaleDateString([], { month: "short", day: "numeric" })}`);
    expect(circles.map((circle) => circle.props.accessibilityState.selected)).toEqual(days.map((_, i) => i === 1));
  });

  it("dims a day without listings and says so, and keeps an unknown day at full ink", async () => {
    const { circles } = await render();
    const opacity = (index: number) => StyleSheet.flatten(circles[index].props.style).opacity;
    expect(opacity(0)).toBeUndefined();
    expect(opacity(7)).toBe(0.35);
    expect(opacity(12)).toBeUndefined();
    expect(circles[0].props.accessibilityLabel).toMatch(/liveTv\.dayListings$/);
    expect(circles[7].props.accessibilityLabel).toMatch(/liveTv\.dayNoListings$/);
    expect(circles[12].props.accessibilityLabel).toMatch(/liveTv\.dayListings$/);
  });

  it("fills the pick gold and passes a press on with the day's midnight", async () => {
    const { circles, onSelect } = await render();
    expect(StyleSheet.flatten(circles[0].props.style).backgroundColor).toBe(COLORS.ACCENT);
    expect(StyleSheet.flatten(circles[1].props.style).backgroundColor).toBeUndefined();
    circles[3].props.onPress();
    expect(onSelect).toHaveBeenCalledWith(days[3].startMs);
  });

  it("sizes its circles so four fit the full channel column and two the phone's compact one", () => {
    const full = { tv: 300, phone: 150 };
    expect(dayStripVisibleCount(full.tv, 48, 12, 12)).toBe(4);
    expect(dayStripVisibleCount(full.phone, 26, 6, 8)).toBe(4);
    expect(dayStripVisibleCount(77, 26, 6, 8)).toBe(2);
    expect(dayStripVisibleCount(DAY_CIRCLE + 2 * DAY_INSET, DAY_CIRCLE, DAY_GAP, DAY_INSET)).toBe(1);
  });
});
