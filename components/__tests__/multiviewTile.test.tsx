/** A multiview spot: its live session with sound only on the main, else its clip, else its picture, else the channel's logo; its programme and time left; a focus ring that takes no space. */
import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let mockFrame: { uri: string; cacheKey: string } | undefined;
let mockClip: { uri: string; cacheKey: string } | undefined;
jest.mock("@keiver/tomo-live/src/clip", () => ({ LiveClipView: (props: object) => require("react").createElement("LiveClipView", props) }));
jest.mock("@/hooks/useLiveFrame", () => ({ useLiveFrame: () => mockFrame, useLiveClip: () => mockClip }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312" }) }));
jest.mock("@/services/jellyfinApi", () => ({ getPosterUrl: (id: string) => `https://jf/Items/${id}/Images/Primary` }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => (key === "liveTv.timeLeft" ? "{time} left" : key === "common.durationMinutes" ? "{minutes}m" : key) }));
jest.mock("expo-image", () => ({ Image: (props: object) => require("react").createElement("Image", props) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { airingLine, MultiviewTile } from "@/components/live-tv/multiview-tile";

const NOW = Date.parse("2026-11-05T20:00:00Z");
const channel = { Id: "c1", Name: "Channel One", Type: "TvChannel" } as never;
const rect = { x: 0, y: 0, width: 320, height: 180 };
const program = { Name: "Evening News", StartDate: "2026-11-05T19:30:00Z", EndDate: "2026-11-05T20:45:00Z" };
type ClipProps = { uri: string | null; live: boolean; muted: boolean; onFailed: () => void };

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

  it("names the programme airing and its time left, and nothing outside its slot", () => {
    expect(airingLine(program, NOW)).toBe("Evening News · 45m left");
    expect(airingLine(program, Date.parse("2026-11-05T21:00:00Z"))).toBeNull();
    const texts = render({ program })
      .tree.root.findAllByType(Text)
      .map((node) => node.props.children);
    expect(texts).toContain("Evening News · 45m left");
  });

  it("takes no border space, so its picture meets the line, and draws focus as a ring over the picture", () => {
    const { tree } = render();
    const touch = tree.root.findByType(TouchableOpacity);
    expect(StyleSheet.flatten(touch.props.style).borderWidth).toBeUndefined();
    const ring = () => tree.root.findAll((node) => node.type === View && StyleSheet.flatten(node.props.style)?.borderColor === "#FFC312");
    expect(ring()).toHaveLength(0);
    act(() => touch.props.onFocus());
    expect(StyleSheet.flatten(tree.root.findByType(TouchableOpacity).props.style).borderWidth).toBeUndefined();
    expect(ring()).toHaveLength(1);
    expect(StyleSheet.flatten(ring()[0].props.style)).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, borderWidth: 4 });
  });

  it("full screen shows the picture alone: no label, and no focus ring even while focused", () => {
    const { tree, clip } = render({ main: true, bare: true, program, liveUrl: "http://127.0.0.1:5000/t/master.m3u8" });
    expect(clip).toMatchObject({ live: true, muted: false });
    act(() => tree.root.findByType(TouchableOpacity).props.onFocus());
    expect(tree.root.findAllByType(Text)).toHaveLength(0);
    expect(tree.root.findAll((node) => node.type === View && StyleSheet.flatten(node.props.style)?.borderColor === "#FFC312")).toHaveLength(0);
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
});
