import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Animated, StyleSheet, Text } from "react-native";
import { GuideCell } from "@/components/live-tv/guide-cell";
import { clearChannelHealth, noteChannelAlive, noteChannelOpenFailure } from "@/services/channelHealth";
import { formatClock, guideMetrics, MINUTE_MS, NO_GUIDE_PREFIX, TICK_MINUTES } from "@/utils/guide";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/jellyfinApi", () => ({ getPosterUrl: (id: string) => `poster:${id}`, getCachedConfig: () => ({ server: "http://jf" }) }));
let mockReel: { frames: { uri: string; cacheKey: string }[]; at: number } | undefined;
jest.mock("@/services/liveFrames", () => ({ liveFrameReel: () => mockReel, subscribeLiveFrame: () => () => undefined }));
jest.mock("expo-image", () => ({ Image: (props: { testID?: string }) => require("react").createElement("Image", props) }));

const T0 = Date.UTC(2026, 8, 12, 4, 0, 0);
const program = { Id: "p1", Name: "Evening News", EpisodeTitle: "Episode 9", StartDate: new Date(T0).toISOString(), EndDate: new Date(T0 + 60 * MINUTE_MS).toISOString(), IsNews: true };
const scrollX = new Animated.Value(0);

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

  it("sets every programme's text on a scrim riding the pinned label, poster or not, never a stand-in's", () => {
    expect(testIds(render())).toContain("guide-cell-scrim");
    expect(testIds(render({ program: { ...program, Id: `${NO_GUIDE_PREFIX}c3`, Name: "No listings", EpisodeTitle: undefined } }))).not.toContain("guide-cell-scrim");
    const tree = render({ program: { ...program, Id: "p9", ImageTags: { Primary: "tag" } } });
    const scrim = tree.root.find((node) => node.props.testID === "guide-cell-scrim" && typeof node.type === "string");
    expect(StyleSheet.flatten(scrim.props.style)).toEqual(expect.objectContaining({ top: 0, bottom: 0 }));
    const tail = tree.root.find((node) => node.props.testID === "guide-cell-scrim-tail" && typeof node.type === "string");
    expect(StyleSheet.flatten(tail.props.style).width).toBe(400);
  });

  it("clips the scrim inside the cell's border, so the grid line between programmes stays visible", () => {
    const clip = render().root.find((node) => node.props.testID === "guide-cell-scrim-clip" && typeof node.type === "string");
    expect(StyleSheet.flatten(clip.props.style)).toEqual(expect.objectContaining({ position: "absolute", left: 0, right: 0, overflow: "hidden" }));
    expect(clip.findAll((node) => node.props.testID === "guide-cell-scrim-tail" && typeof node.type === "string")).toHaveLength(1);
  });

  it("lays the scrim under an airing programme's reel and seen box, never over them", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const ids = testIds(render({ program: { ...program, Id: "p10", ChannelId: "c1", ImageTags: { Primary: "tag" } } }));
    expect(ids.indexOf("guide-cell-scrim")).toBeGreaterThan(-1);
    expect(ids.indexOf("guide-cell-scrim")).toBeLessThan(ids.indexOf("guide-focus-reel"));
    expect(ids.indexOf("guide-cell-scrim")).toBeLessThan(ids.indexOf("guide-cell-seen"));
  });

  it("leads the art in from the left with its own fade, so the poster never starts on a hard edge", () => {
    const tree = render({ program: { ...program, Id: "p11", ImageTags: { Primary: "tag" } } });
    const artWidth = Math.min(160, 400 - guideMetrics(false).pxPerMinute * TICK_MINUTES);
    const lead = tree.root.find((node) => node.props.testID === "guide-cell-art-lead" && typeof node.type === "string");
    expect(StyleSheet.flatten(lead.props.style)).toEqual(expect.objectContaining({ right: "100%", width: Math.min(artWidth, 400 - artWidth) }));
  });

  it("draws no art in a cell that ends inside its first half hour", () => {
    const withArt = { ...program, Id: "p3", ImageTags: { Primary: "tag" } };
    const halfHour = guideMetrics(false).pxPerMinute * TICK_MINUTES;
    expect(testIds(render({ program: withArt, width: halfHour }))).not.toContain("guide-cell-art");
    expect(testIds(render({ program: withArt, width: halfHour + 1 }))).toContain("guide-cell-art");
  });

  it("holds the poster back while the canvas has the cell out of view", () => {
    const withArt = { ...program, Id: "p7", ImageTags: { Primary: "tag" } };
    expect(testIds(render({ program: withArt, showArt: false }))).not.toContain("guide-cell-art");
    expect(testIds(render({ program: withArt, showArt: true }))).toContain("guide-cell-art");
  });

  it("keys the art by its image tag, so a refreshed guide image replaces the cached one", () => {
    const artKey = (tag: string) => render({ program: { ...program, Id: "p4", ImageTags: { Primary: tag } } }).root.findByType("Image" as never).props.source.cacheKey;
    expect(artKey("old")).not.toEqual(artKey("new"));
  });

  it("unrolls the reel on an airing programme without focus, poster or not, and never under a future slot", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const focusedIds = (overrides: Partial<React.ComponentProps<typeof GuideCell>>) => testIds(render(overrides));
    const airing = { ...program, Id: "p5", ChannelId: "c1" };
    expect(focusedIds({ program: airing })).toContain("guide-focus-reel");
    const withPoster = focusedIds({ program: { ...airing, ImageTags: { Primary: "tag" } } });
    expect(withPoster).toEqual(expect.arrayContaining(["guide-cell-art", "guide-focus-reel"]));
    expect(focusedIds({ program: { ...airing, ImageTags: { Primary: "tag" } }, nowMs: T0 - MINUTE_MS })).not.toContain("guide-focus-reel");
  });

  it("sets when this device grabbed the frames in a box flush in the top right corner, on airing and no-listings cells, only while they show", () => {
    const airing = { ...program, Id: "p8", ChannelId: "c1" };
    const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c2`, Name: "No listings", EpisodeTitle: undefined };
    expect(testIds(render({ program: airing }))).not.toContain("guide-cell-seen");
    expect(testIds(render({ program: standIn }))).not.toContain("guide-cell-seen");

    mockReel = { at: T0 + 10 * MINUTE_MS, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    for (const cell of [airing, standIn]) {
      const box = render({ program: cell }).root.findByProps({ testID: "guide-cell-seen" });
      expect(StyleSheet.flatten(box.props.style)).toMatchObject({ position: "absolute", top: 0, right: 0, borderBottomWidth: 1, borderLeftWidth: 1 });
      const line = box.findByType(Text);
      expect(StyleSheet.flatten(line.props.style).textTransform).toBe("uppercase");
      expect(line.props.children[0]).toBe("Seen at ");
      expect(box.findAllByType(Text)[1].props.children).toBe(formatClock(T0 + 10 * MINUTE_MS));
    }
  });

  it("fades the poster down while grabbed frames show over it, focused or not, and only then", () => {
    const withPoster = { ...program, Id: "p6", ChannelId: "c1", ImageTags: { Primary: "tag" } };
    const artOpacity = (tree: TestRenderer.ReactTestRenderer) => StyleSheet.flatten(tree.root.findByProps({ testID: "guide-cell-art" }).props.style).opacity ?? 1;
    const focus = (tree: TestRenderer.ReactTestRenderer) => act(() => tree.root.findByProps({ accessibilityRole: "button" }).props.onFocus());

    const bare = render({ program: withPoster });
    focus(bare);
    expect(artOpacity(bare)).toBe(1);

    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const grabbed = render({ program: withPoster });
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

  it("drops a guide's no info available placeholder from the meta line, dot and all", () => {
    const metaLine = (genre: string) =>
      render({ program: { ...program, Id: "p6", IsNews: false, Genres: [genre] } })
        .root.findAllByType(Text)
        .map((node) => node.props.children)
        .find((child) => typeof child === "string" && child.includes(" – "));
    expect(metaLine("no info available")).not.toContain("·");
    expect(metaLine("Drama")).toContain("  ·  Drama");
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

  it("says under a stand-in what the sampler concluded: streaming after a burst, offline after the origin refuses twice, nothing before", () => {
    const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c9`, Name: "No listings", EpisodeTitle: undefined };
    const status = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByProps({ testID: "guide-cell-status" })[0]?.findByType(Text).props.children;
    try {
      const tree = render({ program: standIn });
      expect(status(tree)).toBeUndefined();
      act(() => noteChannelAlive("c9"));
      expect(status(tree)).toBe("Streaming now");
      act(() => {
        noteChannelOpenFailure("c9", "HTTP 404");
        noteChannelOpenFailure("c9", "HTTP 404");
      });
      expect(status(tree)).toBe("Channel seems offline");
    } finally {
      clearChannelHealth();
    }
  });
});
