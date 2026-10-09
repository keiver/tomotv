import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Animated, StyleSheet, Text } from "react-native";
import { GuideCell } from "@/components/live-tv/guide-cell";
import { clearChannelHealth, noteChannelAlive, noteChannelOpenFailure } from "@/services/channelHealth";
import * as guideChannelFocus from "@/services/guideChannelFocus";
import { formatClock, MINUTE_MS, NO_GUIDE_PREFIX } from "@/utils/guide";

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
const flatText = (node: TestRenderer.ReactTestInstance): string => node.children.map((child) => (typeof child === "string" ? child : flatText(child))).join("");
const testIds = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => typeof node.props.testID === "string").map((node) => node.props.testID as string);

describe("GuideCell", () => {
  afterEach(() => {
    mockReel = undefined;
  });

  it("leads one title row with the episode, the show name trailing, and the slot line", () => {
    const shown = render()
      .root.findAllByType(Text)
      .map((node) => flatText(node));
    expect(shown).toContain("Episode 9  ·  Evening News");
    expect(shown.some((text) => text.includes(" – ") && text.includes("news"))).toBe(true);
    expect(flatText(render({ program: { ...program, Id: "p15", EpisodeTitle: undefined } }).root)).toContain("Evening News");
  });

  it("prints the slot the row parsed, never the programme's dates again", () => {
    const shown = texts(render({ startMs: T0 + 30 * MINUTE_MS, endMs: T0 + 45 * MINUTE_MS }));
    expect(shown.some((text) => typeof text === "string" && text.startsWith(`${formatClock(T0 + 30 * MINUTE_MS)} – ${formatClock(T0 + 45 * MINUTE_MS)}`))).toBe(true);
  });

  it("prints the seconds of a slot shorter than a minute", () => {
    const withSeconds = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" });
    const shown = texts(render({ startMs: T0 + 1_000, endMs: T0 + 31_000 }));
    expect(shown.some((text) => typeof text === "string" && text.startsWith(`${withSeconds(T0 + 1_000)} – ${withSeconds(T0 + 31_000)}`))).toBe(true);
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

  const hostById = (tree: TestRenderer.ReactTestRenderer, id: string) => tree.root.find((node) => node.props.testID === id && typeof node.type === "string");
  const labelOf = (tree: TestRenderer.ReactTestRenderer) => tree.root.find((node) => node.props.isTVSelectable === true && typeof node.type !== "string");

  it("sets every programme's text on a scrim inside its pinned label, never a stand-in's", () => {
    expect(testIds(render({ program: { ...program, Id: `${NO_GUIDE_PREFIX}c3`, Name: "No listings", EpisodeTitle: undefined } }))).not.toContain("guide-cell-scrim");
    const label = labelOf(render());
    const scrim = label.find((node) => node.props.testID === "guide-cell-scrim" && typeof node.type === "string");
    expect(StyleSheet.flatten(scrim.props.style)).toEqual(expect.objectContaining({ top: 1, bottom: 1 }));
    const tail = label.find((node) => node.props.testID === "guide-cell-scrim-tail" && typeof node.type === "string");
    expect(StyleSheet.flatten(tail.props.style).width).toBe(400);
  });

  it("keeps the scrim clear of the focus ring's band whether or not the cell holds focus", () => {
    const tree = render();
    const scrim = () => StyleSheet.flatten(hostById(tree, "guide-cell-scrim").props.style);
    const resting = scrim();
    act(() => labelOf(tree).props.onFocus());
    expect(scrim()).toEqual(resting);
  });

  it("paints the reel inside the focus ring's reserved band", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const tree = render({ program: { ...program, Id: "p14", ChannelId: "c1" }, viewportWidth: 1600 });
    const band = hostById(tree, "guide-cell-band");
    expect(StyleSheet.flatten(band.props.style)).toEqual(expect.objectContaining({ position: "absolute", top: 1, bottom: 1, left: 0, right: 0, overflow: "hidden" }));
    for (const id of ["guide-cell-reel-scrim-clip", "guide-focus-reel"]) {
      expect(band.findAll((node) => node.props.testID === id).length).toBeGreaterThan(0);
    }
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

  it("lays a playing cell's scrim under its reel, never over it", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const tree = render({ program: { ...program, Id: "p10", ChannelId: "c1" } });
    const ids = testIds(tree);
    expect(ids.indexOf("guide-cell-reel-scrim")).toBeGreaterThan(-1);
    expect(ids.indexOf("guide-cell-reel-scrim")).toBeLessThan(ids.indexOf("guide-focus-reel"));
    expect(ids).not.toContain("guide-cell-scrim");
    const clip = hostById(tree, "guide-cell-reel-scrim-clip");
    expect(StyleSheet.flatten(clip.props.style)).toEqual(expect.objectContaining({ position: "absolute", left: 0, right: 0, overflow: "hidden" }));
  });

  it("draws the programme lines without text shadows, the scrim carries the contrast", () => {
    for (const line of render().root.findAllByType(Text)) expect(StyleSheet.flatten(line.props.style).textShadowRadius).toBeUndefined();
  });

  it("wears no reel, seen line or reel scrim, and listens for no card focus, while the canvas has the cell out of view", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const subscribe = jest.spyOn(guideChannelFocus, "subscribeGuideChannelFocus");
    try {
      const airing = { ...program, Id: "p14", ChannelId: "c1" };
      const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c2`, Name: "No listings", EpisodeTitle: undefined };
      for (const cell of [airing, standIn]) {
        const away = testIds(render({ program: cell, showArt: false }));
        expect(away).not.toContain("guide-focus-reel");
        expect(away).not.toContain("guide-cell-seen-line");
        expect(away).not.toContain("guide-cell-reel-scrim");
      }
      expect(testIds(render({ program: airing, showArt: false }))).toContain("guide-cell-scrim");
      expect(subscribe).not.toHaveBeenCalled();
      expect(testIds(render({ program: airing, showArt: true }))).toContain("guide-focus-reel");
      expect(testIds(render({ program: standIn, showArt: true }))).toContain("guide-cell-seen-line");
    } finally {
      subscribe.mockRestore();
    }
  });

  it("unrolls the reel on an airing programme without focus, and never under a future slot", () => {
    mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const airing = { ...program, Id: "p5", ChannelId: "c1" };
    expect(testIds(render({ program: airing }))).toContain("guide-focus-reel");
    expect(testIds(render({ program: airing, airing: false }))).not.toContain("guide-focus-reel");
  });

  it("sets when this device grabbed the frames as a stand-in's second line and leading a programme's slot line, only while they show", () => {
    const airing = { ...program, Id: "p8", ChannelId: "c1" };
    const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c2`, Name: "No listings", EpisodeTitle: undefined };
    for (const cell of [airing, standIn]) {
      expect(testIds(render({ program: cell }))).not.toContain("guide-cell-seen-line");
    }
    expect(flatText(render({ program: airing }).root).includes("Seen at")).toBe(false);

    mockReel = { at: T0 + 10 * MINUTE_MS, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
    const time = formatClock(T0 + 10 * MINUTE_MS);

    const quiet = render({ program: standIn });
    const seenLine = quiet.root.findByProps({ testID: "guide-cell-seen-line" });
    expect(flatText(seenLine)).toBe(`Seen at ${time}`);
    expect(seenLine.findAllByType(Text).some((node) => node.props.children === time)).toBe(true);
    const lines = quiet.root.findAllByType(Text).map((node) => flatText(node));
    expect(lines.indexOf(`Seen at ${time}`)).toBe(lines.indexOf("No listings") + 1);

    const cell = render({ program: airing });
    const slotLine = cell.root.findAllByType(Text).find((node) => flatText(node).includes(" – "))!;
    expect(flatText(slotLine).startsWith(`Seen at ${time}  ·  ${formatClock(T0)}`)).toBe(true);
    expect(slotLine.findAllByType(Text).some((node) => node.props.children === time)).toBe(true);
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
    const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c1`, Name: "No listings", EpisodeTitle: "Select to watch" };
    const tree = render({ program: standIn });
    const title = () => flatText(tree.root.findAllByType(Text)[0]);
    expect(title()).toBe("No listings");
    const pressable = tree.root.findByProps({ accessibilityRole: "button" });
    act(() => pressable.props.onFocus());
    expect(title()).toBe("No listings  ·  Select to watch");
    act(() => pressable.props.onBlur());
    expect(title()).toBe("No listings");
  });

  it("claims under a stand-in that the stream can be tried until frames show, with the origin's death verdict overriding", () => {
    const standIn = { ...program, Id: `${NO_GUIDE_PREFIX}c9`, Name: "No listings", EpisodeTitle: undefined };
    const status = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAllByProps({ testID: "guide-cell-status" })[0]?.findByType(Text).props.children;
    try {
      const tree = render({ program: standIn });
      expect(status(tree)).toBe("Available to stream");
      act(() => noteChannelAlive("c9"));
      expect(status(tree)).toBe("Available to stream");
      // Shown frames carry the claim themselves: the seen line replaces the dot.
      mockReel = { at: T0, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
      const withFrames = render({ program: standIn });
      expect(status(withFrames)).toBeUndefined();
      expect(testIds(withFrames)).toContain("guide-cell-seen-line");
      act(() => {
        noteChannelOpenFailure("c9", "HTTP 404");
        noteChannelOpenFailure("c9", "HTTP 404");
      });
      expect(status(tree)).toBe("Channel seems offline");
      expect(status(withFrames)).toBe("Channel seems offline");
    } finally {
      clearChannelHealth();
    }
  });
});
