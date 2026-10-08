/** The day strip over the channel column: four day boxes in view, listings told by dimming, a touch opens the calendar that picks. */
import { GuideDayPicker } from "@/components/live-tv/guide-day-picker";
import { DAY_BOX, DAYS_IN_VIEW, GuideDayStrip } from "@/components/live-tv/guide-day-strip";
import { COLORS } from "@/constants/colors";
import { DatePicker } from "@expo/ui/swift-ui";
import { guideDays, guideMetrics } from "@/utils/guide";
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
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
  const isBox = (node: TestRenderer.ReactTestInstance) => node.props.isTVSelectable === true;
  const boxes = () => renderer.root.findAll((node) => isBox(node) && !(node.parent && isBox(node.parent)));
  const tiles = () => renderer.root.findAll((node) => node.type === View && node.props.style && StyleSheet.flatten(node.props.style).width === DAY_BOX);
  const texts = () => renderer.root.findAllByType(Text).map((node) => String(node.props.children));
  const container = () => renderer.root.findByType(ScrollView).parent!;
  return { renderer, boxes, tiles, texts, container, onSelect };
}

describe("GuideDayStrip", () => {
  it("draws one box per day, numbered by the day of the month, the month's name on its first day", async () => {
    const { boxes, texts } = await render();
    expect(boxes()).toHaveLength(14);
    expect(texts().slice(1, 9)).toEqual(["24", "25", "26", "27", "28", "29", "30", "31"]);
    expect(texts()[9]).toBe(new Date(2026, 10, 1).toLocaleDateString([], { month: "short" }));
    expect(texts()[10]).toBe("2");
  });

  it("splits the full channel column into four boxes, the corner actions' cells", async () => {
    const { tiles } = await render();
    expect(DAYS_IN_VIEW).toBe(4);
    expect(DAY_BOX * DAYS_IN_VIEW).toBe(guideMetrics(false).channelColumnWidth);
    expect(Number.isInteger(guideMetrics(true).channelColumnWidth / DAYS_IN_VIEW)).toBe(true);
    expect(tiles()).toHaveLength(14);
    expect(StyleSheet.flatten(tiles()[0].props.style).borderRadius).toBeUndefined();
  });

  it("heads the strip with the picked day and marks it selected", async () => {
    const { boxes, texts } = await render(days[1].startMs);
    expect(texts()[0]).toBe(`liveTv.tomorrow · ${new Date(days[1].startMs).toLocaleDateString([], { month: "short", day: "numeric" })}`);
    expect(boxes().map((box) => box.props.accessibilityState.selected)).toEqual(days.map((_, i) => i === 1));
  });

  it("dims a day without listings and says so, and keeps an unknown day at full ink", async () => {
    const { boxes, renderer } = await render();
    const dayText = (index: number) => renderer.root.findAllByType(Text)[index + 1];
    const opacity = (index: number) => StyleSheet.flatten(dayText(index).props.style).opacity;
    expect(opacity(0)).toBeUndefined();
    expect(opacity(7)).toBe(0.35);
    expect(opacity(12)).toBeUndefined();
    expect(boxes()[0].props.accessibilityLabel).toMatch(/liveTv\.dayListings$/);
    expect(boxes()[7].props.accessibilityLabel).toMatch(/liveTv\.dayNoListings$/);
    expect(boxes()[12].props.accessibilityLabel).toMatch(/liveTv\.dayListings$/);
  });

  it("opens the calendar from any box or the heading, a day without listings too, and picks nothing by itself", async () => {
    const { boxes, renderer, onSelect } = await render();
    const picker = () => renderer.root.findByType(GuideDayPicker);
    expect(picker().props.open).toBe(false);
    await act(async () => boxes()[7].props.onPress());
    expect(picker().props.open).toBe(true);
    await act(async () => picker().props.onOpenChange(false));
    await act(async () => renderer.root.findAllByType(Text)[0].props.onPress());
    expect(picker().props.open).toBe(true);
    expect(boxes()[7].props.accessibilityState.disabled).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("bounds the calendar to the days not known to lack listings and passes a pick on as its midnight, then closes", async () => {
    const { boxes, renderer, onSelect } = await render();
    await act(async () => boxes()[0].props.onPress());
    const calendar = () => renderer.root.findByType(DatePicker);
    expect(calendar().props.range.start.getTime()).toBe(days[0].startMs);
    expect(calendar().props.range.end.getTime()).toBe(new Date(2026, 10, 7).getTime() - 1);
    await act(async () => calendar().props.onDateChange(new Date(days[8].startMs + 3_600_000)));
    expect(onSelect).not.toHaveBeenCalled();
    await act(async () => calendar().props.onDateChange(new Date(days[3].startMs + 3_600_000)));
    expect(onSelect).toHaveBeenCalledWith(days[3].startMs);
    expect(renderer.root.findByType(GuideDayPicker).props.open).toBe(false);
  });

  it("centres the heading in capitals", async () => {
    const { renderer } = await render();
    const heading = StyleSheet.flatten(renderer.root.findAllByType(Text)[0].props.style);
    expect(heading.textTransform).toBe("uppercase");
    expect(heading.textAlign).toBe("center");
  });

  it("washes the pick like a picked group", async () => {
    const { tiles } = await render();
    const background = (index: number) => StyleSheet.flatten(tiles()[index].props.style).backgroundColor;
    expect(background(0)).toBe("rgba(52, 199, 89, 0.2)");
    expect(background(1)).toBe("rgba(0, 0, 0, 0.4)");
  });

  it("keeps the green wash under the gold ring when the pick holds focus", async () => {
    const { tiles, boxes, renderer } = await render();
    await act(async () => boxes()[0].props.onFocus());
    expect(StyleSheet.flatten(tiles()[0].props.style).backgroundColor).toBe("rgba(52, 199, 89, 0.2)");
    expect(StyleSheet.flatten(renderer.root.findAllByType(Text)[1].props.style).color).toBe(COLORS.TEXT_PRIMARY);
  });

  it("draws no edge shade", async () => {
    const { container } = await render();
    expect(StyleSheet.flatten(container().props.style).boxShadow).toBeUndefined();
  });

  it("rests a phone swipe on a box edge", async () => {
    const { renderer } = await render();
    const scroll = renderer.root.findByType(ScrollView);
    expect(scroll.props.snapToInterval).toBe(DAY_BOX);
    expect(scroll.props.decelerationRate).toBe("fast");
  });
});
