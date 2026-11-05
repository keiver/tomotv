/** A multiview tile: its live session with sound only on the main, else its clip, else its picture; held on its last frame while frozen. */
import React from "react";
import { TouchableOpacity } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let mockFrame: { uri: string; cacheKey: string } | undefined;
let mockClip: { uri: string; cacheKey: string } | undefined;
jest.mock("@keiver/tomo-live/src/clip", () => ({ LiveClipView: (props: object) => require("react").createElement("LiveClipView", props) }));
jest.mock("@/hooks/useLiveFrame", () => ({ useLiveFrame: () => mockFrame, useLiveClip: () => mockClip }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312" }) }));
jest.mock("expo-image", () => ({ Image: (props: object) => require("react").createElement("Image", props) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { MultiviewTile } from "@/components/live-tv/multiview-tile";

const channel = { Id: "c1", Name: "Channel One", Type: "TvChannel" } as never;
const rect = { x: 0, y: 0, width: 320, height: 180 };
type ClipProps = { uri: string | null; live: boolean; muted: boolean; frozen: boolean; onFrozen: () => void };

function render(props: Partial<React.ComponentProps<typeof MultiviewTile>> = {}) {
  const onSelect = jest.fn();
  const onFrozen = jest.fn();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MultiviewTile channel={channel} rect={rect} main={false} liveUrl={null} frozen={false} visible onSelect={onSelect} onFrozen={onFrozen} {...props} />);
  });
  const clips = tree.root.findAllByType("LiveClipView" as never);
  return { tree, clip: clips[0]?.props as ClipProps | undefined, onSelect, onFrozen };
}

beforeEach(() => {
  mockFrame = { uri: "file:///pool/c1/live-1-3.jpg", cacheKey: "live-c1-1-3" };
  mockClip = { uri: "file:///pool/c1/live-1-clip.mp4", cacheKey: "live-c1-1-clip" };
});

describe("MultiviewTile", () => {
  it("plays its live session with sound when it is the main, muted when a satellite", () => {
    const url = "http://127.0.0.1:5000/t/master.m3u8";
    expect(render({ main: true, liveUrl: url }).clip).toMatchObject({ uri: url, live: true, muted: false });
    expect(render({ liveUrl: url }).clip).toMatchObject({ uri: url, live: true, muted: true });
  });

  it("loops its clip when not live, over its picture, and shows only the picture with no clip", () => {
    const withClip = render();
    expect(withClip.clip).toMatchObject({ uri: mockClip!.uri, live: false });
    expect(withClip.tree.root.findByType("Image" as never).props.source).toEqual(mockFrame);
    mockClip = undefined;
    expect(render().clip).toBeUndefined();
  });

  it("keeps its player, live and holding its frame, while frozen with no session, and reports the hold", () => {
    const { clip, onFrozen } = render({ main: true, frozen: true });
    expect(clip).toMatchObject({ uri: null, live: true, frozen: true });
    clip!.onFrozen();
    expect(onFrozen).toHaveBeenCalledWith("c1");
  });

  it("lets its player go while the screen is covered", () => {
    expect(render({ liveUrl: "http://127.0.0.1:5000/t/master.m3u8", visible: false }).clip).toBeUndefined();
  });

  it("names its channel to the select handler", () => {
    const { tree, onSelect } = render();
    act(() => tree.root.findByType(TouchableOpacity).props.onPress());
    expect(onSelect).toHaveBeenCalledWith("c1");
  });
});
