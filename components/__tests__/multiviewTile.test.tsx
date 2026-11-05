/** A multiview spot: its live session with sound only on the main, else its clip, else its picture, else the channel's logo; its programme and time left; a focus ring that takes no space. */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let mockFrame: { uri: string; cacheKey: string } | undefined;
let mockClip: { uri: string; cacheKey: string } | undefined;
jest.mock("@keiver/tomo-live/src/clip", () => ({ LiveClipView: (props: object) => require("react").createElement("LiveClipView", props) }));
jest.mock("@/hooks/useLiveFrame", () => ({ useLiveFrame: () => mockFrame, useLiveClip: () => mockClip }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312" }) }));
let mockLogo: { uri: string } | undefined;
jest.mock("@/services/itemArtwork", () => ({ posterSource: () => mockLogo }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => (key === "liveTv.timeLeft" ? "{time} left" : key === "common.durationMinutes" ? "{minutes}m" : key) }));
jest.mock("expo-image", () => ({ Image: (props: object) => require("react").createElement("Image", props) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: (props: object) => require("react").createElement("Ionicons", props) }));
const mockRecording = new Set<string>();
jest.mock("@/hooks/useRecordingStatus", () => ({ useChannelRecording: (channelId: string) => mockRecording.has(channelId) }));

import { airingLine, MultiviewTile } from "@/components/live-tv/multiview-tile";

const NOW = Date.parse("2026-11-05T20:00:00Z");
const channel = { Id: "c1", Name: "Channel One", Type: "TvChannel" } as never;
const rect = { x: 0, y: 0, width: 320, height: 180 };
const program = { Name: "Evening News", StartDate: "2026-11-05T19:30:00Z", EndDate: "2026-11-05T20:45:00Z" };
type ClipProps = { uri: string | null; live: boolean; muted: boolean; onFailed: () => void; onPlaying: (event: { nativeEvent: { playing: boolean } }) => void };

function render(props: Partial<React.ComponentProps<typeof MultiviewTile>> = {}) {
  const onSelect = jest.fn();
  const onFailed = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MultiviewTile channel={channel} rect={rect} main={false} liveUrl={null} visible nowMs={NOW} onSelect={onSelect} onFailed={onFailed} {...props} />);
  });
  const clips = tree.root.findAllByType("LiveClipView" as never);
  return { tree, clip: clips[0]?.props as ClipProps | undefined, onSelect, onFailed };
}

beforeEach(() => {
  mockFrame = { uri: "file:///pool/c1/live-1-3.jpg", cacheKey: "live-c1-1-3" };
  mockClip = { uri: "file:///pool/c1/live-1-clip.mp4", cacheKey: "live-c1-1-clip" };
  mockLogo = { uri: "https://jf/Items/c1/Images/Primary" };
  mockRecording.clear();
});

describe("MultiviewTile", () => {
  it("plays its live session with sound when it is the main, muted otherwise", () => {
    const url = "http://127.0.0.1:5000/t/master.m3u8";
    expect(render({ main: true, liveUrl: url }).clip).toMatchObject({ uri: url, live: true, muted: false });
    expect(render({ liveUrl: url }).clip).toMatchObject({ uri: url, live: true, muted: true });
  });

  it("loops its clip when not live, over its picture, and shows only the picture with no clip", () => {
    const withClip = render();
    expect(withClip.clip).toMatchObject({ uri: mockClip!.uri, live: false });
    expect(withClip.tree.root.findAllByType("Image" as never).map((image) => image.props.source)).toEqual([mockFrame]);
    mockClip = undefined;
    expect(render().clip).toBeUndefined();
  });

  it("shows the channel's logo, never black, until a picture arrives", () => {
    mockFrame = undefined;
    mockClip = undefined;
    const images = render().tree.root.findAllByType("Image" as never);
    expect(images.map((image) => image.props.source)).toEqual([{ uri: "https://jf/Items/c1/Images/Primary" }]);
  });

  it("shows a TV glyph for a channel with no logo until a picture arrives", () => {
    mockFrame = undefined;
    mockClip = undefined;
    mockLogo = undefined;
    const { tree } = render();
    expect(tree.root.findAllByType("Image" as never)).toHaveLength(0);
    expect(tree.root.findAllByType("Ionicons" as never).map((icon) => icon.props.name)).toEqual(["tv-outline"]);
  });

  it("names the programme airing and its time left, and nothing outside its slot", () => {
    expect(airingLine(program, NOW)).toBe("Evening News · 45m left");
    expect(airingLine(program, Date.parse("2026-11-05T21:00:00Z"))).toBeNull();
    const texts = (props: Partial<React.ComponentProps<typeof MultiviewTile>>) =>
      render({ program, ...props })
        .tree.root.findAllByType(Text)
        .map((node) => node.props.children);
    expect(texts({ main: true })).toEqual(["Channel One · Evening News · 45m left"]);
    expect(texts({})).toEqual(["Channel One"]);
  });

  it("names the channel in a thin square label in the top-left corner, half a card tab high, over the Live TV card's lit edge", () => {
    const { tree } = render();
    const label = tree.root.findByType(Text).parent!;
    expect(StyleSheet.flatten(label.props.style)).toMatchObject({ position: "absolute", top: 0, left: 0, height: 12 });
    expect(StyleSheet.flatten(label.props.style).borderRadius).toBeUndefined();
    expect(tree.root.findAll((node) => node.type === View && StyleSheet.flatten(node.props.style)?.boxShadow !== undefined)).toHaveLength(1);
  });

  it("takes no border space, so its picture meets the line, and draws focus as a ring over the picture", () => {
    const { tree } = render();
    const touch = tree.root.findByType(TouchableOpacity);
    expect(StyleSheet.flatten(touch.props.style).borderWidth).toBeUndefined();
    const ring = () => tree.root.findAll((node) => node.type === View && StyleSheet.flatten(node.props.style)?.borderColor === "#FFC312" && StyleSheet.flatten(node.props.style)?.bottom === 0);
    expect(ring()).toHaveLength(0);
    act(() => touch.props.onFocus());
    expect(StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style).borderWidth).toBeUndefined();
    expect(ring()).toHaveLength(1);
    expect(StyleSheet.flatten(ring()[0].props.style)).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 4 });
  });

  it("on a touch screen gives the spot with the sound the accent box with no focus, and the others none", () => {
    const ring = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => node.type === View && StyleSheet.flatten(node.props.style)?.borderColor === "#FFC312");
    expect(ring(render({ main: true }).tree)).toHaveLength(1);
    expect(ring(render().tree)).toHaveLength(0);
  });

  it("shows a spinner in the speaker's place on the spot with the sound until its session plays, and again when it stalls", () => {
    const url = "http://127.0.0.1:5000/t/master.m3u8";
    const { tree, clip } = render({ main: true, liveUrl: url });
    const icons = () => tree.root.findAll((node) => (node.type as unknown) === "Ionicons").map((node) => node.props.name);
    const loading = () => tree.root.findAll((node) => node.props.testID === "multiview-tile-loading").length > 0;
    expect(loading()).toBe(true);
    expect(icons()).not.toContain("volume-high");
    act(() => clip!.onPlaying({ nativeEvent: { playing: true } }));
    expect(loading()).toBe(false);
    expect(icons()).toContain("volume-high");
    act(() => tree.root.findAllByType("LiveClipView" as never)[0].props.onPlaying({ nativeEvent: { playing: false } }));
    expect(loading()).toBe(true);
  });

  it("says softly over its picture that a channel that failed to open cannot play, and nothing while it plays live", () => {
    const warn = (props: Partial<React.ComponentProps<typeof MultiviewTile>>) => render(props).tree.root.findAll((node) => node.type === View && node.props.testID === "multiview-tile-warn").length;
    expect(warn({ main: true, failed: true })).toBe(1);
    expect(warn({ main: true })).toBe(0);
    expect(warn({ main: true, failed: true, liveUrl: "http://127.0.0.1:5000/t/master.m3u8" })).toBe(0);
  });

  it("shows no spinner on the spot with the sound while it has no live session to wait for", () => {
    const { tree } = render({ main: true });
    expect(tree.root.findAll((node) => node.props.testID === "multiview-tile-loading")).toHaveLength(0);
  });

  it("shows neither the spinner nor the speaker on a spot without the sound", () => {
    const { tree } = render({ liveUrl: "http://127.0.0.1:5000/t/master.m3u8" });
    expect(tree.root.findAll((node) => node.props.testID === "multiview-tile-loading")).toHaveLength(0);
    expect(tree.root.findAll((node) => (node.type as unknown) === "Ionicons" && node.props.name === "volume-high")).toHaveLength(0);
  });

  it("lets its player go while the screen is covered", () => {
    expect(render({ liveUrl: "http://127.0.0.1:5000/t/master.m3u8", visible: false }).clip).toBeUndefined();
  });

  it("names its channel when its player fails, when selected and when held", () => {
    const onLongPress = jest.fn();
    const { tree, clip, onFailed, onSelect } = render({ liveUrl: "http://127.0.0.1:5000/t/master.m3u8", onLongPress });
    clip!.onFailed();
    expect(onFailed).toHaveBeenCalledWith("c1");
    act(() => tree.root.findByType(TouchableOpacity).props.onPress());
    expect(onSelect).toHaveBeenCalledWith("c1");
    act(() => tree.root.findByType(TouchableOpacity).props.onLongPress());
    expect(onLongPress).toHaveBeenCalledWith("c1");
  });

  describe("played by the app's player", () => {
    it("opens no live player of its own, and shows a muted clip only until the app's player plays", () => {
      const url = "http://127.0.0.1:5000/t/master.m3u8";
      const opening = render({ main: true, liveUrl: url, inPlayer: { playing: false } });
      expect(opening.clip).toMatchObject({ uri: mockClip!.uri, live: false, muted: true });
      expect(opening.tree.root.findAll((node) => node.props.testID === "multiview-tile-loading")).not.toHaveLength(0);
      const playing = render({ main: true, liveUrl: url, inPlayer: { playing: true } });
      expect(playing.clip).toBeUndefined();
      expect(playing.tree.root.findAll((node) => (node.type as unknown) === "Ionicons" && node.props.name === "volume-high")).toHaveLength(1);
    });

    it("drawn over the app's player, is clear with no picture of its own, and carries the label, the ring and the buttons", () => {
      const actions = <View testID="spot-actions" />;
      const { tree, clip } = render({ main: true, overlay: { actions } });
      expect(clip).toBeUndefined();
      expect(tree.root.findAllByType("Image" as never)).toHaveLength(0);
      expect(StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style).backgroundColor).toBe("transparent");
      expect(tree.root.findAll((node) => node.props.testID === "spot-actions")).not.toHaveLength(0);
      expect(tree.root.findAllByType(Text).map((node) => node.props.children)).toContain("Channel One");
    });
  });

  it("marks a channel being recorded with a red dot in its name label, whether or not it has the sound", () => {
    const dot = (props: Partial<React.ComponentProps<typeof MultiviewTile>>) =>
      render(props).tree.root.findAll((node) => node.props.testID === "multiview-tile-recording" && typeof node.type === "string");
    expect(dot({})).toHaveLength(0);
    mockRecording.add("c1");
    expect(dot({})).toHaveLength(1);
    expect(dot({ main: true })).toHaveLength(1);
  });
});
