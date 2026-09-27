import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { StyleSheet, Text } from "react-native";
import { GuideCell } from "@/components/live-tv/guide-cell";
import { guideMetrics, MINUTE_MS, NO_GUIDE_PREFIX, TICK_MINUTES } from "@/utils/guide";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/jellyfinApi", () => ({ getPosterUrl: (id: string) => `poster:${id}`, getCachedConfig: () => ({ server: "http://jf" }) }));
let mockReel: { frames: { uri: string; cacheKey: string }[]; at: number } | undefined;
jest.mock("@/services/liveFrames", () => ({ liveFrameReel: () => mockReel, subscribeLiveFrame: () => () => undefined }));
jest.mock("expo-image", () => ({ Image: (props: { testID?: string }) => require("react").createElement("Image", props) }));

const T0 = Date.UTC(2026, 8, 12, 4, 0, 0);
const program = { Id: "p1", Name: "Evening News", EpisodeTitle: "Episode 9", StartDate: new Date(T0).toISOString(), EndDate: new Date(T0 + 60 * MINUTE_MS).toISOString(), IsNews: true };
const scrollX = { value: 0 } as unknown as import("react-native-reanimated").SharedValue<number>;

function render(overrides: Partial<React.ComponentProps<typeof GuideCell>> = {}) {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(
      <GuideCell program={program} left={0} width={400} height={90} nowMs={T0 + 15 * MINUTE_MS} recording={null} scrollX={scrollX} onPress={jest.fn()} onLongPress={jest.fn()} {...overrides} />,
    );
  });
  return tree!;
}

const texts = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByType(Text).map((node) => node.props.children);
const testIds = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => typeof node.props.testID === "string").map((node) => node.props.testID as string);

describe("GuideCell", () => {
  afterEach(() => {
    mockReel = undefined;
  });

  it("shows the title, episode and the slot line", () => {
    const shown = texts(render());
    expect(shown).toEqual(expect.arrayContaining(["Evening News", "Episode 9"]));
    expect(shown.some((text) => text.includes(" – ") && text.includes("news"))).toBe(true);
  });

  it("bleeds the programme's art in from the right only when it has one", () => {
    expect(testIds(render())).not.toContain("guide-cell-art");
    expect(testIds(render({ program: { ...program, Id: "p2", ImageTags: { Primary: "tag" } } }))).toContain("guide-cell-art");
  });

  it("draws no art in a cell that ends inside its first half hour", () => {
    const withArt = { ...program, Id: "p3", ImageTags: { Primary: "tag" } };
    const halfHour = guideMetrics(false).pxPerMinute * TICK_MINUTES;
    expect(testIds(render({ program: withArt, width: halfHour }))).not.toContain("guide-cell-art");
    expect(testIds(render({ program: withArt, width: halfHour + 1 }))).toContain("guide-cell-art");
  });

  it("keys the art by its image tag, so a refreshed guide image replaces the cached one", () => {
    const artKey = (tag: string) => render({ program: { ...program, Id: "p4", ImageTags: { Primary: tag } } }).root.findByType("Image" as never).props.source.cacheKey;
    expect(artKey("old")).not.toEqual(artKey("new"));
  });

  it("unrolls the reel on focus of an airing programme, poster or not, and never under a future slot", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const focusedIds = (overrides: Partial<React.ComponentProps<typeof GuideCell>>) => {
      const tree = render(overrides);
      act(() => tree.root.findByProps({ accessibilityRole: "button" }).props.onFocus());
      return testIds(tree);
    };
    const airing = { ...program, Id: "p5", ChannelId: "c1" };
    expect(focusedIds({ program: airing })).toContain("guide-focus-reel");
    const withPoster = focusedIds({ program: { ...airing, ImageTags: { Primary: "tag" } } });
    expect(withPoster).toEqual(expect.arrayContaining(["guide-cell-art", "guide-focus-reel"]));
    expect(focusedIds({ program: { ...airing, ImageTags: { Primary: "tag" } }, nowMs: T0 - MINUTE_MS })).not.toContain("guide-focus-reel");
  });

  it("fades the poster down while grabbed frames show over it, and only then", () => {
    const withPoster = { ...program, Id: "p6", ChannelId: "c1", ImageTags: { Primary: "tag" } };
    const artOpacity = (tree: TestRenderer.ReactTestRenderer) => StyleSheet.flatten(tree.root.findByProps({ testID: "guide-cell-art" }).props.style).opacity ?? 1;
    const focus = (tree: TestRenderer.ReactTestRenderer) => act(() => tree.root.findByProps({ accessibilityRole: "button" }).props.onFocus());

    const bare = render({ program: withPoster });
    focus(bare);
    expect(artOpacity(bare)).toBe(1);

    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const grabbed = render({ program: withPoster });
    expect(artOpacity(grabbed)).toBe(1);
    focus(grabbed);
    // The mock evaluates animated styles at render; a nudge re-renders after the effect's set.
    act(() =>
      grabbed.update(<GuideCell program={withPoster} left={0} width={400} height={90} nowMs={T0 + 16 * MINUTE_MS} recording={null} scrollX={scrollX} onPress={jest.fn()} onLongPress={jest.fn()} />),
    );
    expect(artOpacity(grabbed)).toBeLessThan(0.2);
  });

  it("marks a recording with the dot and a series rule with the repeat glyph", () => {
    expect(testIds(render({ recording: "single" }))).toContain("guide-cell-recording");
    expect(testIds(render({ recording: "series" }))).toContain("guide-cell-series");
    expect(testIds(render({ recording: null }))).not.toContain("guide-cell-recording");
  });

  it("presses through with its program and never shows progress on a stand-in cell", () => {
    const onPress = jest.fn();
    const onLongPress = jest.fn();
    const tree = render({ onPress, onLongPress });
    const pressable = tree.root.findByProps({ accessibilityRole: "button" });
    act(() => pressable.props.onPress());
    act(() => pressable.props.onLongPress());
    expect(onPress).toHaveBeenCalledWith(program);
    expect(onLongPress).toHaveBeenCalledWith(program);

    const standIn = render({ program: { ...program, Id: `${NO_GUIDE_PREFIX}c1`, Name: "No listings" } });
    expect(testIds(standIn)).not.toContain("guide-cell-progress");
  });

  it("titles a stand-in cell in the cell's own face, the hint trailing only while focused", () => {
    const flatText = (tree: TestRenderer.ReactTestRenderer) =>
      tree.root
        .findAllByType(Text)
        .flatMap((node) => React.Children.toArray(node.props.children))
        .filter((child): child is string => typeof child === "string")
        .join("");
    const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c1`, Name: "No listings", EpisodeTitle: "Select to watch" };
    const tree = render({ program: standIn });
    expect(flatText(tree)).toBe("No listings");
    const pressable = tree.root.findByProps({ accessibilityRole: "button" });
    act(() => pressable.props.onFocus());
    expect(flatText(tree)).toBe("No listings  ·  Select to watch");
    act(() => pressable.props.onBlur());
    expect(flatText(tree)).toBe("No listings");
  });
});
