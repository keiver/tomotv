/** The refresh press remounts the Live TV screen and its first load tells the viewer how it ended. */
import LiveTvRoute from "@/app/live-tv";
import { NO_GUIDE_PREFIX } from "@/utils/guide";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockCanvasMounts = 0;
let mockFocused = true;
const mockPush = jest.fn();
const mockGuide = { rows: [] as { programs: unknown[] }[], isLoading: false, isUpdating: false, error: null as string | null, nowMs: 0 };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ isConnected: true, isReady: true }) }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn() }) }));
jest.mock("@/components/settings/WhoIsWatchingScreen", () => ({ WhoIsWatchingScreen: () => null }));
jest.mock("@/hooks/useGuide", () => ({ useGuide: () => mockGuide, invalidateGuideReads: jest.fn() }));
jest.mock("@/hooks/useAuthSession", () => ({ useAuthSession: () => "session" }));
jest.mock("@/hooks/useChannelFavoritesSync", () => ({ useChannelFavoritesSync: jest.fn() }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ filter: "all" }) }));
const mockPin = jest.fn();
const mockPinnedFullscreen = jest.fn((channelId: string) => channelId === mockPinnedId);
let mockPinnedId: string | null = null;
let mockPinnedChannel: { Id: string; Name: string } | null = null;
jest.mock("@/hooks/useLivePreview", () => ({
  useLivePreview: () => ({ channel: mockPinnedChannel, opening: false, pin: mockPin, close: jest.fn(), fullscreen: mockPinnedFullscreen, setSlot: jest.fn() }),
}));
type HeaderItem = { label: string; onPress: () => void };
let mockScreenOptions: { unstable_headerRightItems?: () => HeaderItem[] } = {};
jest.mock("@/components/live-tv/guide-canvas", () => {
  const { useEffect } = jest.requireActual("react");
  return {
    GuideCanvas: () => {
      useEffect(() => {
        mockCanvasMounts += 1;
      }, []);
      return null;
    },
  };
});
jest.mock("@/components/live-tv/guide-hud", () => ({ GuideHud: () => null }));
jest.mock("@/components/live-tv/guide-corner-actions", () => ({
  GuideCornerActions: () => null,
  HudAction: () => null,
  HUD_ACTION_ICON: 20,
  MULTIVIEW_SYMBOL: "rectangle.3.group",
  RECORDINGS_SYMBOL: "recordingtape",
}));
jest.mock("@/components/sf-symbol-icon", () => ({ SfSymbolIcon: () => null }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/externalGuide", () => ({ refreshExternalGuide: jest.fn() }));
jest.mock("@/services/toast", () => ({ showToast: jest.fn(), dismissToast: jest.fn() }));
jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return null;
    },
  },
  useIsFocused: () => mockFocused,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: mockPush }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = jest.requireActual("react-native");
  return { SafeAreaListener: View, useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) };
});

describe("Live TV program info navigation", () => {
  const channel = { Id: "c1", Name: "One", Type: "TvChannel" };
  const program = { Id: "epg:c1:1", Name: "Evening News", Overview: "The day's headlines.", StartDate: new Date(60_000).toISOString(), EndDate: new Date(120_000).toISOString() };

  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockGuide, { nowMs: 90_000, rows: [{ programs: [program] }], isLoading: false, isUpdating: false, error: null });
  });

  async function canvas() {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<LiveTvRoute />);
    });
    return tree.root.findByType(GuideCanvas).props;
  }

  it("preserves the selected external programme on long press and a future programme on press", async () => {
    const props = await canvas();
    props.onProgramLongPress(program, channel);
    const destination = mockPush.mock.calls[0][0];
    expect(destination).toMatchObject({ pathname: "/video-info", params: { videoId: "c1", name: "Evening News" } });
    expect(JSON.parse(destination.params.guideProgram)).toEqual({ ...program, ChannelId: "c1", ChannelName: "One" });
    const later = { ...program, Id: "epg:c1:2", Name: "Late News", StartDate: new Date(180_000).toISOString(), EndDate: new Date(240_000).toISOString() };
    props.onProgramPress(later, channel);
    expect(JSON.parse(mockPush.mock.calls[1][0].params.guideProgram)).toMatchObject(later);
  });

  it("opens an airing programme's channel in the player, and only a tap on the channel's card pins it", async () => {
    mockPinnedId = null;
    const props = await canvas();
    props.onProgramPress(program, channel);
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/player", params: { videoId: "c1", videoName: "One", live: "1" } });
    expect(mockPin).not.toHaveBeenCalled();
    props.onChannelPress(channel);
    expect(mockPin.mock.calls).toEqual([[channel]]);
  });

  it("opens the pinned channel's airing programme full screen in place, pushing no player", async () => {
    mockPinnedId = "c1";
    const props = await canvas();
    mockPush.mockClear();
    props.onProgramPress(program, channel);
    expect(mockPinnedFullscreen).toHaveBeenLastCalledWith("c1");
    expect(mockPush).not.toHaveBeenCalled();
    mockPinnedId = null;
  });

  it("still fetches a server programme by id and opens a no-guide cell on the channel", async () => {
    const props = await canvas();
    props.onProgramLongPress({ ...program, Id: "server-program" }, channel);
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/video-info", params: { videoId: "server-program", name: "Evening News" } });
    props.onProgramLongPress({ ...program, Id: `${NO_GUIDE_PREFIX}c1` }, channel);
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/video-info", params: { videoId: "c1", name: "One" } });
  });
});

describe("Live TV bar on iPhone, iPad and Mac", () => {
  const headerItems = async () => {
    await act(async () => {
      TestRenderer.create(<LiveTvRoute />);
    });
    return mockScreenOptions.unstable_headerRightItems?.() ?? [];
  };

  const rows = (count: number) => Array.from({ length: count }, (_, i) => ({ channel: { Id: `c${i}`, Name: `Channel ${i}` }, programs: [] }));

  beforeEach(() => {
    jest.clearAllMocks();
    mockPinnedChannel = null;
  });
  afterEach(() => {
    mockPinnedChannel = null;
  });

  it("holds Channels, Multiview and Recordings, Multiview only with two channels or more", async () => {
    Object.assign(mockGuide, { rows: rows(2), isLoading: false, isUpdating: false, error: null });
    expect((await headerItems()).map((item) => item.label)).toEqual(["liveTv.channels", "liveTv.multiview", "liveTv.recordings"]);
    Object.assign(mockGuide, { rows: rows(1) });
    expect((await headerItems()).map((item) => item.label)).toEqual(["liveTv.channels", "liveTv.recordings"]);
  });

  it("opens Multiview on the pinned channel when one plays, else on the stored spots", async () => {
    Object.assign(mockGuide, { rows: rows(2), isLoading: false, isUpdating: false, error: null });
    (await headerItems())[1].onPress();
    expect(mockPush).toHaveBeenLastCalledWith("/multiview");
    mockPinnedChannel = { Id: "c7", Name: "Seven" };
    (await headerItems())[1].onPress();
    expect(mockPush).toHaveBeenLastCalledWith({ pathname: "/multiview", params: { channelId: "c7", channelName: "Seven" } });
  });
});

const { GuideCanvas } = jest.requireMock("@/components/live-tv/guide-canvas") as { GuideCanvas: React.ComponentType };
const { refreshExternalGuide } = jest.requireMock("@/services/externalGuide") as { refreshExternalGuide: jest.Mock };
const { invalidateGuideReads } = jest.requireMock("@/hooks/useGuide") as { invalidateGuideReads: jest.Mock };
const { showToast, dismissToast } = jest.requireMock("@/services/toast") as { showToast: jest.Mock; dismissToast: jest.Mock };

async function refreshThenLand(landed: Partial<typeof mockGuide>) {
  Object.assign(mockGuide, { rows: [], isLoading: false, error: null });
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<LiveTvRoute />);
  });
  const press = renderer.root.findByType(GuideCanvas).props.hudRow.props.cornerActions.props.onPress as () => void;
  mockGuide.isLoading = true;
  await act(async () => press());
  const whilePending = showToast.mock.calls.length;
  Object.assign(mockGuide, { isLoading: false }, landed);
  await act(async () => renderer.update(<LiveTvRoute />));
  return { whilePending };
}

describe("Live TV refresh", () => {
  beforeEach(() => {
    mockCanvasMounts = 0;
    mockFocused = true;
    jest.clearAllMocks();
  });

  it("remounts the screen, re-downloads the guides, drops the cached reads and announces the update", async () => {
    const { whilePending } = await refreshThenLand({ rows: [{ programs: [{}] }] });
    expect(mockCanvasMounts).toBe(2);
    expect(refreshExternalGuide).toHaveBeenCalledTimes(1);
    expect(invalidateGuideReads).toHaveBeenCalledTimes(1);
    expect(whilePending).toBe(1);
    expect(showToast.mock.calls).toEqual([[{ id: "guide-refresh", title: "liveTv.guideDownloading", progress: true }], [{ id: "guide-refresh", title: "liveTv.guideUpdated", kind: "success" }]]);
  });

  it("says so when the refresh brought no listings", async () => {
    await refreshThenLand({ rows: [{ programs: [] }] });
    expect(showToast).toHaveBeenLastCalledWith({ id: "guide-refresh", title: "liveTv.noGuide", kind: "info" });
  });

  it("says the guide is unavailable when the load failed", async () => {
    await refreshThenLand({ error: "offline" });
    expect(showToast).toHaveBeenLastCalledWith({ id: "guide-refresh", title: "liveTv.guideUnavailable", kind: "error" });
  });

  it("stays silent on a first open that fetched no programs", async () => {
    Object.assign(mockGuide, { rows: [{ programs: [{}] }], isLoading: false, isUpdating: false, error: null });
    await act(async () => {
      TestRenderer.create(<LiveTvRoute />);
    });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("stays silent on a first open whose load fetched programs, and on the loads after it", async () => {
    Object.assign(mockGuide, { rows: [], isLoading: true, isUpdating: true, error: null });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<LiveTvRoute />);
    });
    Object.assign(mockGuide, { rows: [{ programs: [{}] }], isLoading: false, isUpdating: false });
    await act(async () => renderer.update(<LiveTvRoute />));
    // A day pick loads under the same flags; it says nothing either.
    Object.assign(mockGuide, { isLoading: true, isUpdating: true });
    await act(async () => renderer.update(<LiveTvRoute />));
    Object.assign(mockGuide, { isLoading: false, isUpdating: false });
    await act(async () => renderer.update(<LiveTvRoute />));
    expect(showToast).not.toHaveBeenCalled();
  });

  it("stays silent when the background tab's first load lands while another screen is focused", async () => {
    mockFocused = false;
    Object.assign(mockGuide, { rows: [], isLoading: true, isUpdating: true, error: null });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<LiveTvRoute />);
    });
    Object.assign(mockGuide, { rows: [{ programs: [{}] }], isLoading: false, isUpdating: false });
    await act(async () => renderer.update(<LiveTvRoute />));
    expect(showToast).not.toHaveBeenCalled();
    // Focusing the settled guide later announces nothing either.
    mockFocused = true;
    await act(async () => renderer.update(<LiveTvRoute />));
    expect(showToast).not.toHaveBeenCalled();
  });

  it("resolves the refresh's progress toast quietly when the viewer left before it landed", async () => {
    Object.assign(mockGuide, { rows: [], isLoading: false, error: null });
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<LiveTvRoute />);
    });
    const press = renderer.root.findByType(GuideCanvas).props.hudRow.props.cornerActions.props.onPress as () => void;
    mockGuide.isLoading = true;
    await act(async () => press());
    mockFocused = false;
    Object.assign(mockGuide, { rows: [{ programs: [{}] }], isLoading: false });
    await act(async () => renderer.update(<LiveTvRoute />));
    expect(showToast.mock.calls).toEqual([[{ id: "guide-refresh", title: "liveTv.guideDownloading", progress: true }]]);
    expect(dismissToast).toHaveBeenCalledWith("guide-refresh");
  });
});
