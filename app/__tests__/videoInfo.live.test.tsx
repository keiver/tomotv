/** The info panel on a guide programme or a channel: Watch while it airs, the record controls, the channel's Groups. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { useLocalSearchParams } from "expo-router";
import VideoInfoScreen from "@/app/video-info";
import { cancelSeriesTimer, cancelTimer, createSeriesTimer, createTimer, fetchItemDetails, fetchLiveTvManagement, fetchSeriesTimers, fetchTimerDefaults, fetchTimers } from "@/services/jellyfinApi";

const mockPush = jest.fn();
const mockReplace = jest.fn();
jest.mock("expo-router", () => ({
  useLocalSearchParams: jest.fn(),
  useRouter: () => ({ push: mockPush, replace: mockReplace, back: jest.fn() }),
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
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
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: () => null }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
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
  formatDuration: () => "",
  getBackdropUrl: () => null,
  getLogoUrl: () => null,
  getPersonImageUrl: () => null,
  getPosterUrl: () => null,
  hasPoster: () => false,
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

async function mount(item: object) {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ videoId: (item as { Id: string }).Id });
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

  it("offers only Watch when the account may not manage recordings, and never Delete or Show in Folder", async () => {
    (fetchLiveTvManagement as jest.Mock).mockResolvedValue(false);
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    const tree = await mount(airing);
    expect(buttons(tree)).toEqual(["Watch"]);
    expect(fetchTimers).not.toHaveBeenCalled();
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

  it("records a manual timer on a channel and opens its Groups with the channel", async () => {
    (fetchTimers as jest.Mock).mockResolvedValue([]);
    (fetchTimerDefaults as jest.Mock).mockResolvedValue({ PrePaddingSeconds: 0 });
    const tree = await mount(channel);
    expect(buttons(tree)).toEqual(["Watch", "Record", "Groups"]);
    await press(tree, "Record");
    expect(fetchTimerDefaults).toHaveBeenCalledWith();
    expect(createTimer).toHaveBeenCalledWith(expect.objectContaining({ ChannelId: "c1", Name: "One", PrePaddingSeconds: 0 }));

    await press(tree, "Groups");
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/channel-groups", params: { channelId: "c1", channelName: "One", channelNumber: "7" } });
  });
});
