import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Animated, StyleSheet, Text } from "react-native";
import { GuideCell } from "@/components/live-tv/guide-cell";
import { artFadeGradient } from "@/components/live-tv/guide-cell-art";
import * as guidePin from "@/components/live-tv/guide-pin";
import { clearChannelHealth, noteChannelAlive, noteChannelOpenFailure } from "@/services/channelHealth";
import * as guideChannelFocus from "@/services/guideChannelFocus";
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
      <GuideCell
        program={program}
        left={0}
        width={400}
        height={90}
        startMs={T0}
        endMs={T0 + 60 * MINUTE_MS}
        past={false}
        airing
        recording={null}
        scrollX={scrollX}
        onPress={jest.fn()}
        onLongPress={jest.fn()}
        {...overrides}
      />,
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

  it("prints the slot the row parsed, never the programme's dates again", () => {
    const shown = texts(render({ startMs: T0 + 30 * MINUTE_MS, endMs: T0 + 45 * MINUTE_MS }));
    expect(shown.some((text) => typeof text === "string" && text.startsWith(`${formatClock(T0 + 30 * MINUTE_MS)} – ${formatClock(T0 + 45 * MINUTE_MS)}`))).toBe(true);
  });

  it("builds the seen box's pin only while grabbed frames show", () => {
    const pinRight = jest.spyOn(guidePin, "pinRightOffset");
    try {
      render({ viewportWidth: 1600 });
      expect(pinRight).not.toHaveBeenCalled();
      mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
      render({ program: { ...program, Id: "p12", ChannelId: "c1" }, viewportWidth: 1600 });
      expect(pinRight).toHaveBeenCalledTimes(1);
    } finally {
      pinRight.mockRestore();
    }
  });

  it("listens for its channel card's focus only while it can wear a reel", () => {
    const subscribe = jest.spyOn(guideChannelFocus, "subscribeGuideChannelFocus");
    try {
      render({ program: { ...program, Id: "p13", ChannelId: "c1" }, airing: false });
      expect(subscribe).not.toHaveBeenCalled();
      render({ program: { ...program, Id: "p13", ChannelId: "c1" } });
      render({ program: { ...program, Id: `${NO_GUIDE_PREFIX}c2`, Name: "No listings" }, airing: false });
      expect(subscribe).toHaveBeenCalledTimes(2);
    } finally {
      subscribe.mockRestore();
    }
  });

  it("bleeds the programme's art in from the right only when it has one", () => {
    expect(testIds(render())).not.toContain("guide-cell-art");
    expect(testIds(render({ program: { ...program, Id: "p2", ImageTags: { Primary: "tag" } } }))).toContain("guide-cell-art");
  });

  const hostById = (tree: TestRenderer.ReactTestRenderer, id: string) => tree.root.find((node) => node.props.testID === id && typeof node.type === "string");
  const labelOf = (tree: TestRenderer.ReactTestRenderer) => tree.root.find((node) => node.props.isTVSelectable === true && typeof node.type !== "string");

  it("sets every programme's text on a scrim inside its pinned label, poster or not, never a stand-in's", () => {
    expect(testIds(render({ program: { ...program, Id: `${NO_GUIDE_PREFIX}c3`, Name: "No listings", EpisodeTitle: undefined } }))).not.toContain("guide-cell-scrim");
    for (const cell of [program, { ...program, Id: "p9", ImageTags: { Primary: "tag" } }]) {
      const label = labelOf(render({ program: cell }));
      const scrim = label.find((node) => node.props.testID === "guide-cell-scrim" && typeof node.type === "string");
      expect(StyleSheet.flatten(scrim.props.style)).toEqual(expect.objectContaining({ top: 0, bottom: 0 }));
      const tail = label.find((node) => node.props.testID === "guide-cell-scrim-tail" && typeof node.type === "string");
      expect(StyleSheet.flatten(tail.props.style).width).toBe(400);
    }
  });

  it("clears the focus ring's top and bottom lines with the scrim while focused", () => {
    const tree = render();
    act(() => labelOf(tree).props.onFocus());
    expect(StyleSheet.flatten(hostById(tree, "guide-cell-scrim").props.style)).toEqual(expect.objectContaining({ top: 1, bottom: 1 }));
  });

  it("frames the stretch on screen with a focused no-listings cell's ring, while a programme's ring keeps its own cell", () => {
    const ring = (tree: TestRenderer.ReactTestRenderer) => StyleSheet.flatten(hostById(tree, "guide-cell-ring").props.style);
    const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c4`, Name: "No listings", EpisodeTitle: undefined };
    const wide = render({ program: standIn, width: 6000, viewportWidth: 1600, airing: false });
    act(() => labelOf(wide).props.onFocus());
    expect(ring(wide)).toMatchObject({ left: -1, right: "auto", width: 1600 });
    expect(ring(wide).transform).toHaveLength(1);
    // A window narrower than the screen: the ring is the cell's own, both grid lines covered.
    const narrow = render({ program: standIn, width: 900, viewportWidth: 1600, airing: false });
    act(() => labelOf(narrow).props.onFocus());
    expect(ring(narrow).width).toBe(902);

    const cell = render({ width: 6000, viewportWidth: 1600 });
    act(() => labelOf(cell).props.onFocus());
    expect(ring(cell)).toMatchObject({ left: -1, right: -1 });
    expect(ring(cell).width).toBeUndefined();
  });

  it("clips the label inside the cell's border, so the scrim's fade never covers the grid line", () => {
    const tree = render();
    const clip = hostById(tree, "guide-cell-label-clip");
    expect(StyleSheet.flatten(clip.props.style)).toEqual(expect.objectContaining({ position: "absolute", left: 0, right: 0, overflow: "hidden" }));
    expect(clip.findAll((node) => node.props.testID === "guide-cell-scrim-tail" && typeof node.type === "string")).toHaveLength(1);
  });

  it("lays a playing cell's scrim under its reel and seen box, never over them", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const tree = render({ program: { ...program, Id: "p10", ChannelId: "c1", ImageTags: { Primary: "tag" } } });
    const ids = testIds(tree);
    expect(ids.indexOf("guide-cell-reel-scrim")).toBeGreaterThan(-1);
    expect(ids.indexOf("guide-cell-reel-scrim")).toBeLessThan(ids.indexOf("guide-focus-reel"));
    expect(ids.indexOf("guide-cell-reel-scrim")).toBeLessThan(ids.indexOf("guide-cell-seen"));
    expect(ids).not.toContain("guide-cell-scrim");
    const clip = hostById(tree, "guide-cell-reel-scrim-clip");
    expect(StyleSheet.flatten(clip.props.style)).toEqual(expect.objectContaining({ position: "absolute", left: 0, right: 0, overflow: "hidden" }));
  });

  it("fades the art with one gradient that darkens the floor up to the poster's edge, then clears across it", () => {
    const tree = render({ program: { ...program, Id: "p11", ImageTags: { Primary: "tag" } } });
    const artWidth = Math.min(160, 400 - guideMetrics(false).pxPerMinute * TICK_MINUTES);
    const lead = Math.min(artWidth, 400 - artWidth);
    const fade = StyleSheet.flatten(hostById(tree, "guide-cell-art-fade").props.style);
    expect(fade).toEqual(expect.objectContaining({ right: 0, width: lead + artWidth, experimental_backgroundImage: artFadeGradient(lead, artWidth) }));
    expect(artFadeGradient(100, 300)).toBe("linear-gradient(to right, rgba(44, 44, 46, 0) 0%, #2C2C2E 25%, rgba(44, 44, 46, 0) 100%)");
  });

  it("draws the programme lines without text shadows, the scrim carries the contrast", () => {
    for (const line of render().root.findAllByType(Text)) expect(StyleSheet.flatten(line.props.style).textShadowRadius).toBeUndefined();
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

  it("wears no reel, seen box or reel scrim, and listens for no card focus, while the canvas has the cell out of view", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const subscribe = jest.spyOn(guideChannelFocus, "subscribeGuideChannelFocus");
    try {
      const airing = { ...program, Id: "p14", ChannelId: "c1" };
      const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c2`, Name: "No listings", EpisodeTitle: undefined };
      for (const cell of [airing, standIn]) {
        const away = testIds(render({ program: cell, showArt: false }));
        expect(away).not.toContain("guide-focus-reel");
        expect(away).not.toContain("guide-cell-seen");
        expect(away).not.toContain("guide-cell-reel-scrim");
      }
      expect(testIds(render({ program: airing, showArt: false }))).toContain("guide-cell-scrim");
      expect(subscribe).not.toHaveBeenCalled();
      expect(testIds(render({ program: airing, showArt: true }))).toEqual(expect.arrayContaining(["guide-focus-reel", "guide-cell-seen"]));
    } finally {
      subscribe.mockRestore();
    }
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
    expect(focusedIds({ program: { ...airing, ImageTags: { Primary: "tag" } }, airing: false })).not.toContain("guide-focus-reel");
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
      grabbed.update(
        <GuideCell
          program={withPoster}
          left={0}
          width={400}
          height={90}
          startMs={T0}
          endMs={T0 + 60 * MINUTE_MS}
          past={false}
          airing
          recording={null}
          scrollX={scrollX}
          onPress={jest.fn()}
          onLongPress={jest.fn()}
        />,
      ),
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
