/** Multiview: the chosen channel on the main stage, the channels around it as satellites, a satellite swapped in on select, the main full screen on select. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

type TileProps = {
  channel: { Id: string };
  main: boolean;
  liveUrl: string | null;
  frozen: boolean;
  visible: boolean;
  onSelect: (id: string) => void;
  onLongPress?: () => void;
  rect: { width: number };
};
let mockTiles: TileProps[] = [];
let mockParams: Record<string, string> = {};
let mockFocused = true;
const mockPush = jest.fn();
const mockSetLiveTiles = jest.fn();
const mockViewable = jest.fn();
const mockActive = jest.fn();
const mockPause = jest.fn();
const mockUnavailable = new Set<string>();
const mockLiveUrls = new Map<string, string>();
let mockTvHandler: ((event: { eventType: string }) => void) | null = null;

jest.mock("react-native/Libraries/Components/TV/useTVEventHandler", () => ({
  __esModule: true,
  default: (handler: (event: { eventType: string }) => void) => {
    mockTvHandler = handler;
  },
}));
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => mockParams,
  useIsFocused: () => mockFocused,
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn() }) }));
const mockWall = Array.from({ length: 20 }, (_, i) => ({ Id: `c${i}`, Name: `Channel ${i}`, Type: "TvChannel" }));
jest.mock("@/hooks/useChannelWall", () => ({ useChannelWall: () => ({ wall: mockWall }) }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ autoUpdate: true }) }));
jest.mock("@/services/liveFrames", () => ({
  setLiveFramesActive: (surface: string, active: boolean) => mockActive(surface, active),
  setLiveFrameViewable: (surface: string, ids: string[]) => mockViewable(surface, ids),
}));
jest.mock("@/services/liveTiles", () => ({
  setLiveTiles: (ids: string[]) => mockSetLiveTiles(ids),
  liveTileUrl: (id: string) => mockLiveUrls.get(id) ?? null,
  liveTileFrozen: () => false,
  liveTileUnavailable: (id: string) => mockUnavailable.has(id),
  liveTilesVersion: () => 0,
  subscribeLiveTiles: () => () => {},
  noteLiveTileFrozen: jest.fn(),
  pauseLiveTileMain: () => mockPause(),
}));
jest.mock("@keiver/tomo-live", () => jest.requireActual("@keiver/tomo-live/src/multiviewLayout"));
jest.mock("@/components/live-tv/multiview-tile", () => ({
  MultiviewTile: (props: TileProps) => {
    mockTiles.push(props);
    return null;
  },
}));

import MultiviewScreen from "@/app/multiview";
import { View } from "react-native";

/** A landscape phone window: room for the main and seven satellites (multiviewCapacity). */
const STAGE = { width: 852, height: 393 };

function mount(): TestRenderer.ReactTestRenderer {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MultiviewScreen />);
  });
  const stage = tree.root.findAll((node) => node.type === View && typeof node.props.onLayout === "function")[0];
  mockTiles = [];
  act(() => stage.props.onLayout({ nativeEvent: { layout: STAGE } }));
  return tree;
}

/** The tiles of the last render, in order. */
const lastTiles = () => {
  const count = mockSetLiveTiles.mock.calls.at(-1)?.[0].length ?? 0;
  return mockTiles.slice(-count);
};

beforeEach(() => {
  jest.clearAllMocks();
  mockTiles = [];
  mockParams = {};
  mockFocused = true;
  mockUnavailable.clear();
  mockLiveUrls.clear();
});

describe("Multiview", () => {
  it("puts the chosen channel on the main stage and the channels around it as satellites, and hands them to the tile sessions", () => {
    mockParams = { channelId: "c10" };
    mount();
    expect(mockSetLiveTiles).toHaveBeenLastCalledWith(["c10", "c7", "c8", "c9", "c11", "c12", "c13", "c14"]);
    const tiles = lastTiles();
    expect(tiles.map((tile) => tile.main)).toEqual([true, false, false, false, false, false, false, false]);
    expect(tiles[0].rect.width).toBeGreaterThan(tiles[1].rect.width * 2 - 1);
  });

  it("opens from the bar on the group's first channel, wrapping round the list", () => {
    mount();
    expect(mockSetLiveTiles.mock.calls.at(-1)?.[0][0]).toBe("c0");
    expect(mockSetLiveTiles.mock.calls.at(-1)?.[0]).toContain("c19");
  });

  it("leaves out channels that cannot be satellites, and keeps a chosen main that is one", () => {
    mockParams = { channelId: "c10" };
    mockUnavailable.add("c9").add("c10");
    mount();
    const order = mockSetLiveTiles.mock.calls.at(-1)?.[0] as string[];
    expect(order[0]).toBe("c10");
    expect(order).not.toContain("c9");
    expect(order).toHaveLength(8);
  });

  it("swaps a selected satellite onto the main stage, only those two moving", () => {
    mockParams = { channelId: "c10" };
    mount();
    act(() => lastTiles()[5].onSelect("c12"));
    expect(mockSetLiveTiles).toHaveBeenLastCalledWith(["c12", "c7", "c8", "c9", "c11", "c10", "c13", "c14"]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("opens the main full screen when it is selected", () => {
    mockParams = { channelId: "c10" };
    mount();
    act(() => lastTiles()[0].onSelect("c10"));
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/player", params: { videoId: "c10", videoName: "Channel 10", live: "1" } });
  });

  it("reports the satellites not playing live to the sampler, never the main", () => {
    mockParams = { channelId: "c10" };
    mockLiveUrls.set("c11", "http://127.0.0.1/t/master.m3u8");
    mount();
    expect(mockActive).toHaveBeenCalledWith("multiview", true);
    expect(mockViewable).toHaveBeenLastCalledWith("multiview", ["c7", "c8", "c9", "c12", "c13", "c14"]);
    expect(lastTiles()[4].liveUrl).toBe("http://127.0.0.1/t/master.m3u8");
  });

  it("pauses the main for a round of grabs on Play/Pause, and on a long press of the main only", () => {
    mount();
    act(() => mockTvHandler?.({ eventType: "playPause" }));
    expect(mockPause).toHaveBeenCalledTimes(1);
    const tiles = lastTiles();
    expect(tiles[0].onLongPress).toBeDefined();
    expect(tiles[1].onLongPress).toBeUndefined();
  });

  it("has its tiles let their players go while the player covers it, and ends every tile session when it closes", () => {
    mockFocused = false;
    const tree = mount();
    expect(lastTiles().every((tile) => !tile.visible)).toBe(true);
    act(() => tree.unmount());
    expect(mockSetLiveTiles).toHaveBeenLastCalledWith([]);
    expect(mockViewable).toHaveBeenLastCalledWith("multiview", []);
  });
});
