/** Multiview: a fixed layout of live spots, the viewer's picture spots and a strip row, kept per user; the sound spot full screen on select, the layout picker on Play/Pause, and queued programmes taking the sound spot when they start. */
import React from "react";
import { Alert, Platform, ScrollView } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import type { MultiviewArrangement, MultiviewQueued } from "@/services/liveTvPreferences";

type Prefs = { autoUpdate: boolean; multiview: MultiviewArrangement; multiviewQueue: MultiviewQueued[] };
let mockPrefs: Prefs;
const mockListeners = new Set<() => void>();
let mockParams: Record<string, string> = {};
let mockFocused = true;
const mockPush = jest.fn();
const mockSetLiveTiles = jest.fn();
const mockViewable = jest.fn();
const mockActive = jest.fn();
const mockFailed = jest.fn();
const mockInfoPanel = jest.fn();
const mockWindow = jest.fn();
const mockUnavailable = new Set<string>();
const mockFailedTiles = new Set<string>();
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
  useFocusEffect: (effect: () => void) => {
    const focused = mockFocused;
    require("react").useEffect(() => {
      if (focused) effect();
    }, [focused, effect]);
  },
  Stack: { Screen: () => null },
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312" }) }));
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => mockInfoPanel }));
const mockLoader = jest.fn();
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: mockLoader }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
const mockWall = Array.from({ length: 20 }, (_, i) => ({ Id: `c${i}`, Name: `Channel ${i}`, Type: "TvChannel" }));
jest.mock("@/hooks/useChannelWall", () => ({ useChannelWall: () => ({ wall: mockWall }) }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({
  useLiveTvPreferences: () =>
    require("react").useSyncExternalStore(
      (listener: () => void) => {
        mockListeners.add(listener);
        return () => mockListeners.delete(listener);
      },
      () => mockPrefs,
    ),
}));
jest.mock("@/services/liveTvPreferences", () => ({
  updateLiveTvPreferences: (patch: Partial<Prefs>) => {
    mockPrefs = { ...mockPrefs, ...patch };
    mockListeners.forEach((listener) => listener());
  },
  getLiveTvPreferences: () => mockPrefs,
}));
jest.mock("@/services/jellyfinApi", () => ({ fetchChannelWindow: (ids: string[]) => mockWindow(ids) }));
jest.mock("@/services/liveFrames", () => ({
  setLiveFramesActive: (surface: string, active: boolean) => mockActive(surface, active),
  setLiveFrameViewable: (surface: string, ids: string[]) => mockViewable(surface, ids),
}));
jest.mock("@/services/liveTiles", () => ({
  setLiveTiles: (ids: string[], options?: { chosen?: readonly string[] }) => mockSetLiveTiles(ids, options),
  liveTileUrl: (id: string) => mockLiveUrls.get(id) ?? null,
  liveTileUnavailable: (id: string) => mockUnavailable.has(id),
  liveTileFailed: (id: string) => mockFailedTiles.has(id),
  liveTilesVersion: () => 0,
  subscribeLiveTiles: () => () => {},
  noteLiveTileFailed: (id: string) => mockFailed(id),
}));
jest.mock("@keiver/tomo-live", () => jest.requireActual("@keiver/tomo-live/src/multiviewLayout"));
const mockMounts: string[] = [];
jest.mock("@/components/live-tv/multiview-tile", () => ({
  MultiviewTile: ({ channel }: { channel: { Id: string } }) => {
    require("react").useEffect(() => {
      mockMounts.push(channel.Id);
    }, []);
    return null;
  },
}));
jest.mock("@/components/live-tv/multiview-empty-spot", () => ({ MultiviewEmptySpot: () => null }));

import MultiviewScreen from "@/app/multiview";
import { MultiviewEmptySpot } from "@/components/live-tv/multiview-empty-spot";
import { MultiviewTile } from "@/components/live-tv/multiview-tile";

type TileProps = React.ComponentProps<typeof MultiviewTile>;
type Button = { text?: string; onPress?: () => void };
/** A 16:9 window, so the layout fills it. */
const STAGE = { width: 1280, height: 720 };
const NOW = Date.parse("2026-11-05T20:00:00Z");

let tree: TestRenderer.ReactTestRenderer;
function mount(layout: { width: number; height: number } = STAGE) {
  act(() => {
    tree = TestRenderer.create(<MultiviewScreen />);
  });
  const stage = tree.root.findAll((node) => node.type === ScrollView && typeof node.props.onLayout === "function")[0];
  act(() => stage.props.onLayout({ nativeEvent: { layout } }));
}
const tiles = () => tree.root.findAllByType(MultiviewTile).map((node) => node.props as TileProps);
const spots = () => tiles().filter((tile) => tile.onLongPress);
const strip = () => tiles().filter((tile) => !tile.onLongPress);
const lastLive = () => mockSetLiveTiles.mock.calls.at(-1);
const store = (multiview: Partial<MultiviewArrangement>, multiviewQueue: MultiviewQueued[] = []) => {
  mockPrefs = { ...mockPrefs, multiview: { ...mockPrefs.multiview, ...multiview }, multiviewQueue };
};
/** Presses the button named `text` in the last sheet shown. */
const press = (alert: jest.SpyInstance, text: string) => {
  const buttons = alert.mock.calls.at(-1)?.[2] as Button[];
  act(() => buttons.find((button) => button.text === text)?.onPress?.());
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers({ now: NOW });
  mockPrefs = { autoUpdate: true, multiview: { layout: "bigThree", spots: [], chosen: [] }, multiviewQueue: [] };
  mockListeners.clear();
  mockParams = {};
  mockFocused = true;
  mockUnavailable.clear();
  mockFailedTiles.clear();
  mockLiveUrls.clear();
  mockWindow.mockResolvedValue([]);
});

afterEach(() => {
  act(() => tree?.unmount());
  jest.useRealTimers();
});

describe("Multiview", () => {
  it("puts the chosen channel in the big spot and the channels around it in the others, stores them, and opens a viewer-chosen session only for it", () => {
    mockParams = { channelId: "c10" };
    mount();
    expect(mockPrefs.multiview).toMatchObject({ layout: "bigThree", spots: ["c10", "c9", "c11", "c12"], chosen: ["c10"] });
    expect(lastLive()).toEqual([["c10", "c9", "c11", "c12"], { chosen: ["c10"] }]);
    const [big, ...small] = spots();
    expect(big.main).toBe(true);
    expect(small.every((tile) => !tile.main && tile.rect.width < big.rect.width)).toBe(true);
  });

  it("keeps a chosen channel the group's list does not hold in the big spot, under its own name", () => {
    mockParams = { channelId: "x99", channelName: "Ninety-nine" };
    mount();
    expect(mockPrefs.multiview.spots).toEqual(["x99", "c19", "c0", "c1"]);
    expect(spots()[0].channel).toMatchObject({ Id: "x99", Name: "Ninety-nine" });
  });

  it("leaves out channels that cannot fill a spot on their own, and keeps a chosen one that cannot", () => {
    mockParams = { channelId: "c10" };
    mockUnavailable.add("c9").add("c10");
    mount();
    expect(mockPrefs.multiview.spots).toEqual(["c10", "c8", "c11", "c12"]);
  });

  it("opens from the bar on the stored arrangement, and on the group's first channel when nothing is stored", () => {
    store({ layout: "bigTwo", spots: ["c5", "c6", null], chosen: ["c5"] });
    mount();
    expect(lastLive()).toEqual([["c5", "c6"], { chosen: ["c5"] }]);
    act(() => tree.unmount());
    store({ layout: "bigThree", spots: [], chosen: [] });
    mount();
    expect(mockPrefs.multiview.spots).toEqual(["c0", "c19", "c1", "c2"]);
  });

  it("swaps a selected small spot into the big one in a featured layout, with no full screen", () => {
    mockParams = { channelId: "c10" };
    mount();
    act(() => spots()[2].onSelect("c11"));
    expect(mockPrefs.multiview.spots).toEqual(["c11", "c9", "c10", "c12"]);
    expect(lastLive()?.[0]).toEqual(["c11", "c9", "c10", "c12"]);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("moves only the sound to a selected spot in an equal layout", () => {
    store({ layout: "grid4", spots: ["c10", "c9", "c11", "c12"], chosen: ["c10"] });
    mount();
    act(() => spots()[2].onSelect("c11"));
    expect(mockPrefs.multiview.spots).toEqual(["c10", "c9", "c11", "c12"]);
    expect(lastLive()?.[0]).toEqual(["c11", "c10", "c9", "c12"]);
    expect(spots().map((tile) => tile.main)).toEqual([false, false, true, false]);
  });

  it("opens no session for a picture spot, and brings its channel into the spot with the sound when selected", () => {
    store({ layout: "rowThree", spots: ["c1", "c2", "c3", "c7", null, null], chosen: ["c7"] });
    mockLiveUrls.set("c7", "http://127.0.0.1/t/master.m3u8");
    mount();
    expect(lastLive()?.[0]).toEqual(["c1", "c2", "c3"]);
    expect(spots()[3]).toMatchObject({ main: false, liveUrl: null });
    expect(tree.root.findAllByType(MultiviewEmptySpot)).toHaveLength(2);
    act(() => spots()[3].onSelect("c7"));
    expect(mockPrefs.multiview.spots).toEqual(["c7", "c2", "c3", "c1", null, null]);
    expect(lastLive()?.[0]).toEqual(["c7", "c2", "c3"]);
  });

  it("on iPhone, iPad and Mac opens the channel with the sound in the player when its spot is selected", () => {
    mockParams = { channelId: "c10" };
    mount();
    act(() => spots()[0].onSelect("c10"));
    expect(mockLoader).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/player", params: { videoId: "c10", videoName: "Channel 10", live: "1" } });
  });

  it("on Apple TV fills the screen with the spot with the sound under the full screen route, the same tile playing on bare, and brings the layout back when it returns", () => {
    const tv = jest.spyOn(Platform, "isTV", "get").mockReturnValue(true);
    mockParams = { channelId: "c10" };
    mount();
    const sessions = mockSetLiveTiles.mock.calls.length;
    mockMounts.length = 0;
    act(() => spots()[0].onSelect("c10"));
    expect(mockPush).toHaveBeenCalledWith("/multiview-full");
    // The full screen route covers Multiview: it is no longer focused, and the spot keeps its player.
    mockFocused = false;
    act(() => tree.update(<MultiviewScreen />));
    expect(spots()).toHaveLength(1);
    expect(strip()).toHaveLength(0);
    expect(spots()[0]).toMatchObject({ main: true, visible: true, bare: true, rect: { x: 0, y: 0, width: STAGE.width, height: STAGE.height } });
    expect(mockMounts).toEqual([]);
    expect(mockSetLiveTiles.mock.calls.length).toBe(sessions);
    mockFocused = true;
    act(() => tree.update(<MultiviewScreen />));
    expect(spots()).toHaveLength(4);
    expect(spots().every((tile) => !tile.bare)).toBe(true);
    expect(strip().length).toBeGreaterThan(0);
    tv.mockRestore();
  });

  it("shows an empty spot as a plus that opens the channel picker for that spot", () => {
    store({ layout: "bigTwo", spots: ["c5", "c6", null], chosen: ["c5"] });
    mount();
    const empty = tree.root.findAllByType(MultiviewEmptySpot);
    expect(empty).toHaveLength(1);
    act(() => empty[0].props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/multiview-pick", params: { spot: "2" } });
  });

  it("offers Change channel, Clear, Record and Layout on a spot's long press, Layout opening the layout picker", () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockParams = { channelId: "c10" };
    mount();
    act(() => spots()[1].onLongPress?.("c9"));
    expect(alert.mock.calls.at(-1)?.[0]).toBe("Channel 9");
    press(alert, "liveTv.multiviewChange");
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/multiview-pick", params: { spot: "1" } });
    press(alert, "liveTv.record");
    expect(mockInfoPanel).toHaveBeenCalledWith(expect.objectContaining({ Id: "c9" }));
    press(alert, "liveTv.multiviewLayout");
    expect(mockPush).toHaveBeenLastCalledWith("/multiview-layout");
    press(alert, "liveTv.multiviewClear");
    expect(mockPrefs.multiview.spots).toEqual(["c10", null, "c11", "c12"]);
    alert.mockRestore();
  });

  it("opens the layout picker on Play/Pause", () => {
    mount();
    act(() => mockTvHandler?.({ eventType: "playPause" }));
    expect(mockPush).toHaveBeenCalledWith("/multiview-layout");
  });

  it("scrolls the group's other channels in the layout's strip row, opening no stream for them, and puts a selected one in the sound spot", () => {
    mockParams = { channelId: "c10" };
    mount();
    expect(strip().map((tile) => tile.channel.Id)).toEqual(mockWall.map((channel) => channel.Id).filter((id) => !["c10", "c9", "c11", "c12"].includes(id)));
    expect(strip().every((tile) => tile.liveUrl === null)).toBe(true);
    act(() => strip()[0].onSelect("c0"));
    expect(mockPrefs.multiview.spots).toEqual(["c0", "c9", "c11", "c12"]);
    expect(lastLive()?.[1]).toEqual({ chosen: ["c0"] });
  });

  it("on a portrait phone stacks the spots down the screen, the big one full width, and the group in rows below", () => {
    mockParams = { channelId: "c10" };
    mount({ width: 393, height: 700 });
    const [big, ...small] = spots().map((tile) => tile.rect);
    expect(big).toMatchObject({ x: 0, y: 0, width: 393 });
    expect(small.every((rect) => rect.y > big.y + big.height)).toBe(true);
    const lowest = Math.max(...small.map((rect) => rect.y + rect.height));
    expect(strip().every((tile) => tile.rect.y > lowest)).toBe(true);
  });

  it("on a screen wider than the layout runs the group down the side of the spots and on in rows under them, in the one scrolling stage", () => {
    store({ layout: "grid4", spots: ["c1", "c2", "c3", "c4"], chosen: [] });
    mount({ width: 734, height: 340 });
    const right = Math.max(...spots().map((tile) => tile.rect.x + tile.rect.width));
    const bottom = Math.max(...spots().map((tile) => tile.rect.y + tile.rect.height));
    const cards = strip().map((tile) => tile.rect);
    expect(cards.slice(0, 4).every((rect) => rect.x > right && rect.x + rect.width <= 734 + 0.01)).toBe(true);
    expect(cards[4].x).toBe(0);
    expect(cards[4].y).toBeGreaterThan(bottom);
    expect(tree.root.findAll((node) => node.type === ScrollView && !node.props.horizontal && !node.props.onLayout)).toHaveLength(0);
  });

  it("lays the strip's cards on the grid's columns, the line between them 2 pt", () => {
    mockParams = { channelId: "c10" };
    mount();
    const column = spots()[1].rect;
    const cards = strip().map((tile) => tile.rect);
    expect(cards[3]).toMatchObject({ x: column.x, width: column.width });
    expect(cards[1].x - (cards[0].x + cards[0].width)).toBeCloseTo(2, 5);
  });

  it("labels each spot with the programme airing on its channel", async () => {
    const program = { Name: "Evening News", StartDate: "2026-11-05T19:30:00Z", EndDate: "2026-11-05T20:45:00Z" };
    mockWindow.mockResolvedValue([{ Id: "c10", Name: "Channel 10", CurrentProgram: program }]);
    mockParams = { channelId: "c10" };
    mount();
    await act(async () => {});
    expect(mockWindow).toHaveBeenCalledWith(["c10", "c9", "c11", "c12"]);
    expect(spots()[0].program).toEqual(program);
  });

  it("puts a queued programme airing now in the sound spot, and one still to come when it starts", () => {
    const entry = (channelId: string, startMs: number): MultiviewQueued => ({ channelId, name: "Match", startMs, endMs: startMs + 3_600_000 });
    mockParams = { channelId: "c10" };
    mockPrefs.multiviewQueue = [entry("c4", NOW - 60_000), entry("c6", NOW + 120_000)];
    mount();
    expect(mockPrefs.multiview.spots[0]).toBe("c4");
    expect(mockPrefs.multiviewQueue.map((queued) => queued.channelId)).toEqual(["c6"]);
    act(() => jest.advanceTimersByTime(120_000));
    expect(mockPrefs.multiview.spots[0]).toBe("c6");
    expect(mockPrefs.multiview.chosen).toContain("c6");
    expect(mockPrefs.multiviewQueue).toEqual([]);
  });

  it("reports the spots not playing live, never the sound spot, and the strip channels in view to the sampler", () => {
    mockParams = { channelId: "c10" };
    mockLiveUrls.set("c11", "http://127.0.0.1/t/master.m3u8");
    mount();
    expect(mockActive).toHaveBeenCalledWith("multiview", true);
    expect(mockViewable.mock.calls.at(-1)?.[1].slice(0, 6)).toEqual(["c9", "c12", "c0", "c1", "c2", "c3"]);
    expect(spots()[2].liveUrl).toBe("http://127.0.0.1/t/master.m3u8");
  });

  it("marks only the spot with the sound as failed when its channel could not be opened", () => {
    mockParams = { channelId: "c10" };
    mockFailedTiles.add("c10").add("c9");
    mount();
    expect(spots().map((tile) => tile.failed)).toEqual([true, false, false, false]);
  });

  it("hands a failed player to the tile sessions", () => {
    mount();
    spots()[1].onFailed("c19");
    expect(mockFailed).toHaveBeenCalledWith("c19");
  });

  it("has its spots let their players go while the player covers it, and ends every tile session when it closes", () => {
    mockFocused = false;
    mount();
    expect(tiles().every((tile) => !tile.visible)).toBe(true);
    act(() => tree.unmount());
    expect(mockSetLiveTiles).toHaveBeenLastCalledWith([], undefined);
    expect(mockViewable).toHaveBeenLastCalledWith("multiview", []);
  });
});
