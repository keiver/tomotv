/** The info panel on a guide programme or a channel: Watch while it airs, the record controls, the channel's Groups. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import VideoInfoScreen from "@/app/video-info";
import {
  cancelSeriesTimer,
  cancelTimer,
  createSeriesTimer,
  createTimer,
  fetchItemDetails,
  fetchItemFolderPath,
  fetchLiveTvManagement,
  fetchSeriesTimers,
  fetchTimerDefaults,
  fetchTimers,
} from "@/services/jellyfinApi";
import { programInfoParams } from "@/utils/programInfo";
import { formatClock } from "@/utils/guide";

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("react-native-gesture-handler", () => {
  const { View } = require("react-native");
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Pan: () => chain, Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children, GestureHandlerRootView: View };
});
jest.mock("@/services/localRemux", () => ({
  predictPlaybackLane: jest.fn(async () => null),
  posterFrameIfCached: jest.fn(() => undefined),
  posterFrameRevision: jest.fn(() => 0),
  requestPosterFrame: jest.fn(async () => null),
  cancelPosterFrame: jest.fn(),
}));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("@/hooks/useFolderPlay", () => ({ useFolderPlay: () => jest.fn() }));
jest.mock("@/hooks/useShowInFolder", () => ({ useShowInFolder: () => jest.fn() }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/close-overlay-button", () => ({ CloseOverlayButton: () => null }));
jest.mock("@/components/info-action-row", () => ({
  InfoActionRow: ({ extras = [] }: { extras?: { key: string; label: string }[] }) => {
    const { Text } = require("react-native");
    return extras.map((extra) => <Text key={extra.key} testID={`circle:${extra.label}`} />);
  },
}));
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { loadAsync: jest.fn(async () => ({ width: 16, height: 9 })) }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/FocusableButton", () => ({
  FocusableButton: ({ title, onPress, disabled }: { title: string; onPress: () => void; disabled?: boolean }) => {
    const { Text } = require("react-native");
    return <Text testID={`button:${title}`} onPress={disabled ? undefined : onPress} />;
  },
}));
jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  deleteItem: jest.fn(async () => {}),
  fetchIsAdministrator: jest.fn(async () => true),
  isLiveChannel: (item: { Type?: string } | null) => item?.Type === "TvChannel",
  fetchItemDetails: jest.fn(),
  fetchFolderMediaKinds: jest.fn(async () => null),
  fetchItemFolderPath: jest.fn(async () => [{ id: "channels-folder" }]),
  getBackdropUrl: () => null,
  getLogoUrl: () => null,
  getPersonImageUrl: () => null,
  getCachedConfig: () => ({ server: "https://jf" }),
  getPosterUrl: (id: string) => `https://jf/Items/${id}/Images/Primary`,
  hasPoster: (item: { ImageTags?: { Primary?: string } }) => !!item.ImageTags?.Primary,
  isAudioItem: () => false,
  isFolder: () => false,
  isPhoto: () => false,
  isBook: () => false,
  notifyResumeChange: jest.fn(),
  setVideoFavorite: jest.fn(async () => {}),
  setVideoPlayed: jest.fn(async () => {}),
  cancelTimer: jest.fn(),
  cancelSeriesTimer: jest.fn(),
  createTimer: jest.fn(),
  createSeriesTimer: jest.fn(),
  fetchTimerDefaults: jest.fn(),
  fetchTimers: jest.fn(),
  fetchSeriesTimers: jest.fn(),
  fetchLiveTvManagement: jest.fn(),
}));
jest.mock("@/hooks/useTunerGroups", () => ({ useTunerGroups: () => [] }));

const now = Date.now();
const airing = {
  Id: "p1",
  Name: "Football Live",
  Type: "Program",
  ChannelId: "c1",
  ChannelName: "One",
  StartDate: new Date(now - 10 * 60_000).toISOString(),
  EndDate: new Date(now + 50 * 60_000).toISOString(),
  IsSeries: true,
  IsSports: true,
};
const later = { ...airing, StartDate: new Date(now + 60 * 60_000).toISOString(), EndDate: new Date(now + 120 * 60_000).toISOString() };
const channel = { Id: "c1", Name: "One", Type: "TvChannel", ChannelNumber: "7" };

async function settle() {
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(item: object, params = { videoId: (item as { Id: string }).Id }) {
  (useLocalSearchParams as jest.Mock).mockReturnValue(params);
  (fetchItemDetails as jest.Mock).mockResolvedValue(item);
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoScreen />);
  });
  await settle();
  return tree!;
}

const buttons = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root
    .findAll((node) => typeof node.type === "string" && typeof node.props.testID === "string" && node.props.testID.startsWith("button:"))
    .map((node) => node.props.testID.slice("button:".length));
const press = async (tree: TestRenderer.ReactTestRenderer, title: string) => {
  await act(async () => {
    tree.root.findByProps({ testID: `button:${title}` }).props.onPress();
  });
  await settle();
};

describe("Video info: live items", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (fetchTimerDefaults as jest.Mock).mockResolvedValue({ ProgramId: "p1", Name: "Football Live" });
    (createTimer as jest.Mock).mockResolvedValue(undefined);
    (createSeriesTimer as jest.Mock).mockResolvedValue(undefined);
    (cancelTimer as jest.Mock).mockResolvedValue(undefined);
    (cancelSeriesTimer as jest.Mock).mockResolvedValue(undefined);
    (fetchSeriesTimers as jest.Mock).mockResolvedValue([]);
    (fetchLiveTvManagement as jest.Mock).mockResolvedValue(true);
  });

  const external = { ...later, Id: "epg:c1:1", Name: "Evening News", EpisodeTitle: "World Report", Overview: "The day's headlines.", Genres: ["News"] };

  it("renders the external programme's metadata and channel logo without fetching a server item", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const tree = await mount(channel, programInfoParams(external, channel));
    const rendered = JSON.stringify(tree.toJSON());
    for (const text of [external.Name, external.EpisodeTitle, external.Overview, "News", formatClock(Date.parse(external.StartDate)), formatClock(Date.parse(external.EndDate))]) {
      expect(rendered).toContain(text);
    }
    expect(Image.loadAsync).toHaveBeenCalledWith(expect.objectContaining({ uri: "https://jf/Items/c1/Images/Primary" }));
    expect(fetchItemDetails).not.toHaveBeenCalled();
    expect(fetchItemFolderPath).not.toHaveBeenCalled();
    expect(buttons(tree)).toEqual(["Record"]);
  });

  it("schedules and cancels an external programme by channel and times, never a synthetic ProgramId", async () => {
    (fetchTimers as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ Id: "manual-1", ChannelId: "c1", StartDate: external.StartDate, EndDate: external.EndDate, Status: "New" }])
      .mockResolvedValue([]);
    (fetchTimerDefaults as jest.Mock).mockResolvedValue({ PrePaddingSeconds: 0 });
    const tree = await mount(channel, programInfoParams(external, channel));
    await press(tree, "Record");
    expect(fetchTimerDefaults).toHaveBeenCalledWith();
    expect(createTimer).toHaveBeenCalledWith({ PrePaddingSeconds: 0, ChannelId: "c1", Name: external.Name, Overview: external.Overview, StartDate: external.StartDate, EndDate: external.EndDate });
    expect(buttons(tree)).toEqual(["Cancel Recording"]);
    await press(tree, "Cancel Recording");
    expect(cancelTimer).toHaveBeenCalledWith("manual-1");
    expect(buttons(tree)).toEqual(["Record"]);
  });

  it("watches an airing external programme on its channel and records only to its end", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    (fetchTimerDefaults as jest.Mock).mockResolvedValue({});
    const current = { ...external, StartDate: airing.StartDate, EndDate: airing.EndDate };
    const tree = await mount(channel, programInfoParams(current, channel));
    expect(buttons(tree)).toEqual(["Watch", "Record"]);
    const beforeRecord = Date.now();
    await press(tree, "Record");
    const timer = (createTimer as jest.Mock).mock.calls[0][0];
    expect(timer).toMatchObject({ ChannelId: "c1", EndDate: current.EndDate });
    expect(timer.ProgramId).toBeUndefined();
    expect(Date.parse(timer.StartDate)).toBeGreaterThanOrEqual(beforeRecord);
    expect(Date.parse(timer.StartDate)).toBeLessThanOrEqual(Date.now());
    await press(tree, "Watch");
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/player", params: { videoId: "c1", videoName: "One", live: "1" } });
  });

  it("shows an external synopsis with incomplete times without waiting for recording state", async () => {
    const tree = await mount(channel, programInfoParams({ ...external, EndDate: undefined }, channel));
    expect(JSON.stringify(tree.toJSON())).toContain(external.Overview);
    expect(JSON.stringify(tree.toJSON())).not.toContain("Invalid Date");
    expect(buttons(tree)).toEqual([]);
    expect(fetchTimers).not.toHaveBeenCalled();
  });

  it("keeps an ended external programme readable without Watch or Record", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const ended = { ...external, StartDate: new Date(now - 120_000).toISOString(), EndDate: new Date(now - 60_000).toISOString() };
    const tree = await mount(channel, programInfoParams(ended, channel));
    expect(JSON.stringify(tree.toJSON())).toContain(external.Overview);
    expect(buttons(tree)).toEqual([]);
  });

  it.each(["not json", JSON.stringify({ ...external, ChannelId: "other-channel" })])("falls back to the channel for invalid guide route data: %s", async (guideProgram) => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const tree = await mount(channel, { videoId: "c1", ...{ guideProgram } });
    expect(fetchItemDetails).toHaveBeenCalledWith("c1");
    expect(buttons(tree)).toEqual(["Watch", "Record"]);
  });

  it("offers only Watch when the account may not manage recordings, and never Delete or Show in Folder", async () => {
    (fetchLiveTvManagement as jest.Mock).mockResolvedValue(false);
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const tree = await mount(airing);
    expect(buttons(tree)).toEqual(["Watch"]);
    expect(fetchTimers).not.toHaveBeenCalled();
  });

  it("paints no CTA until the record state answers, then Watch and Record at once", async () => {
    let release!: (timers: never[]) => void;
    (fetchTimers as jest.Mock).mockImplementation(() => new Promise((resolve) => (release = resolve)));
    const tree = await mount(channel);
    expect(buttons(tree)).toEqual([]);
    await act(async () => release([]));
    await settle();
    expect(buttons(tree)).toEqual(expect.arrayContaining(["Watch", "Record"]));
  });

  it("offers Watch, Record and Record Series for an airing series, and Watch replaces the sheet with the channel", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const tree = await mount(airing);
    expect(buttons(tree)).toEqual(["Watch", "Record", "Record Series"]);
    await press(tree, "Record Series");
    expect(createSeriesTimer).toHaveBeenCalledWith({ ProgramId: "p1", Name: "Football Live" });
    await press(tree, "Watch");
    expect(mockReplace).toHaveBeenCalledWith({ pathname: "/player", params: { videoId: "c1", videoName: "One", live: "1" } });
  });

  it("offers no Record on a programme that has ended, only its series", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const ended = { ...airing, StartDate: new Date(now - 60 * 60_000).toISOString(), EndDate: new Date(now - 30 * 60_000).toISOString() };
    const tree = await mount(ended);
    expect(buttons(tree)).toEqual(["Record Series"]);
  });

  it("records from the server's defaults and then offers to cancel", async () => {
    (fetchTimers as jest.Mock)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ Id: "t1", Name: "Football Live", ProgramId: "p1", StartDate: later.StartDate, EndDate: later.EndDate, Status: "New" }]);
    const tree = await mount(later);
    expect(buttons(tree)).toEqual(["Record", "Record Series"]);
    await press(tree, "Record");
    expect(fetchTimerDefaults).toHaveBeenCalledWith("p1");
    expect(createTimer).toHaveBeenCalledWith({ ProgramId: "p1", Name: "Football Live" });
    expect(buttons(tree)).toEqual(["Cancel Recording", "Record Series"]);
  });

  it("cancels one airing by its timer id and keeps offering to cancel the series rule that survives it", async () => {
    const seriesAiring = { Id: "t2", Name: "Football Live", ProgramId: "p1", SeriesTimerId: "s1", StartDate: later.StartDate, EndDate: later.EndDate };
    (fetchSeriesTimers as jest.Mock).mockResolvedValue([{ Id: "s1", Name: "Football Live", ProgramId: "p0" }]);
    (fetchTimers as jest.Mock).mockResolvedValueOnce([{ ...seriesAiring, Status: "New" }]).mockResolvedValue([{ ...seriesAiring, Status: "Cancelled" }]);
    const tree = await mount(later);
    expect(buttons(tree)).toEqual(["Cancel Recording", "Cancel Series"]);
    await press(tree, "Cancel Recording");
    expect(cancelTimer).toHaveBeenCalledWith("t2");
    expect(buttons(tree)).toEqual(["Record", "Cancel Series"]);
    (fetchSeriesTimers as jest.Mock).mockResolvedValue([]);
    await press(tree, "Cancel Series");
    expect(cancelSeriesTimer).toHaveBeenCalledWith("s1");
    expect(buttons(tree)).toEqual(["Record", "Record Series"]);
  });

  it("stops an in-progress recording", async () => {
    (fetchTimers as jest.Mock)
      .mockResolvedValueOnce([{ Id: "t4", Name: "Football Live", ProgramId: "p1", StartDate: airing.StartDate, EndDate: airing.EndDate, Status: "InProgress" }])
      .mockResolvedValue([]);
    const tree = await mount(airing);
    expect(buttons(tree)).toEqual(["Watch", "Stop Recording", "Record Series"]);
    await press(tree, "Stop Recording");
    expect(cancelTimer).toHaveBeenCalledWith("t4");
    expect(buttons(tree)).toEqual(["Watch", "Record", "Record Series"]);
  });

  it("records a manual timer on a channel", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    (fetchTimerDefaults as jest.Mock).mockResolvedValue({ PrePaddingSeconds: 0 });
    const tree = await mount(channel);
    expect(buttons(tree)).toEqual(["Watch", "Record"]);
    await press(tree, "Record");
    expect(fetchTimerDefaults).toHaveBeenCalledWith();
    expect(createTimer).toHaveBeenCalledWith(expect.objectContaining({ ChannelId: "c1", Name: "One", PrePaddingSeconds: 0 }));
  });

  it("lists a channel's groups inline under the CTAs on touch, and no stream sections", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const tree = await mount({
      ...channel,
      MediaStreams: [
        { Type: "Video", Index: 0 },
        { Type: "Audio", Index: 1 },
      ],
    });
    expect(tree.root.findAllByProps({ accessibilityRole: "checkbox", accessibilityLabel: "Favorites" }).length).toBeGreaterThan(0);
    const headings = tree.root.findAll((node) => typeof node.type === "string" && (node.props.children === "Video" || node.props.children === "Audio"));
    expect(headings).toHaveLength(0);
  });

  it("draws the channel logo even when the load before details fails", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const logo = { width: 645, height: 300 };
    (Image.loadAsync as jest.Mock).mockImplementation(async (source: { uri: string }) => {
      if (!source.uri) throw new Error("Image url is blacklisted");
      return logo;
    });
    const tree = await mount({ ...channel, ImageTags: { Primary: "tag" } });
    expect(Image.loadAsync).not.toHaveBeenCalledWith(expect.objectContaining({ uri: "" }));
    expect(tree.root.findAll((node) => node.props.source === logo).length).toBeGreaterThan(0);
  });
});
