/** A channel's info panel offers Rename and Hide beside its other actions; a film's panel does not. Rename saves the typed name, Hide confirms, hides and closes the panel. */
import { VideoInfoPanel } from "@/components/video-info-panel";
import { InfoActionRow, type InfoExtraAction } from "@/components/info-action-row";
import { fetchItemDetails } from "@/services/jellyfinApi";
import { invalidateChannelListReads } from "@/services/jellyfin/channelEdits";
import { hideChannel, renameChannel } from "@/services/liveTvPreferences";
import type { JellyfinItem } from "@/types/jellyfin";
import React from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const channel = { Id: "ch-1", Name: "Channel One", Type: "TvChannel", ImageTags: {} } as unknown as JellyfinItem;
const film = { Id: "m-1", Name: "A Film", Type: "Movie", ImageTags: {}, MediaStreams: [] } as unknown as JellyfinItem;
const mockRouter = { back: jest.fn(), push: jest.fn(), replace: jest.fn() };

jest.mock("expo-router", () => ({ useRouter: () => mockRouter }));
jest.mock("react-native-gesture-handler", () => {
  const chain: any = new Proxy(() => chain, { get: () => () => chain, apply: () => chain });
  return { Gesture: { Native: () => chain }, GestureDetector: ({ children }: { children: React.ReactNode }) => children };
});
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/services/localRemux", () => ({
  predictPlaybackLane: jest.fn(async () => null),
  posterFrameIfCached: jest.fn(() => undefined),
  posterFrameRevision: jest.fn(() => 0),
  requestPosterFrame: jest.fn(async () => null),
  cancelPosterFrame: jest.fn(),
}));
jest.mock("@/hooks/useFolderPlay", () => ({ useFolderPlay: () => jest.fn() }));
jest.mock("@/hooks/useShowInFolder", () => ({ useShowInFolder: () => jest.fn() }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/hooks/useLiveTvManagement", () => ({ useLiveTvManagement: () => false }));
jest.mock("@/hooks/useLiveFrame", () => ({ useLiveFrame: () => undefined, useLiveClip: () => undefined, useLiveFrameSeenAt: () => 0 }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ autoUpdate: false }) }));
jest.mock("@/hooks/usePlaybackHeld", () => ({ usePlaybackHeld: () => false }));
jest.mock("@/hooks/useChannelHealth", () => ({ useChannelHealth: () => "unknown" }));
jest.mock("@/services/nextUp", () => ({ containerKey: () => null, dismissNextUpContainer: jest.fn() }));
jest.mock("@/contexts/LoadingContext", () => ({ useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/info-action-row", () => ({ InfoActionRow: () => null }));
jest.mock("@/components/info-focus-row", () => ({ InfoFocusRow: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/progress-button", () => ({ ProgressButton: () => null }));
jest.mock("@/components/live-tv/channel-group-band", () => ({ ChannelGroupBand: () => null }));
jest.mock("@/components/live-tv/live-clip", () => ({ LiveClip: () => null }));
jest.mock("expo-image", () => ({ Image: Object.assign(() => null, { loadAsync: async () => ({ width: 16, height: 9 }) }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/jellyfin/channelEdits", () => ({ invalidateChannelListReads: jest.fn(), withChannelEdits: (item: unknown) => item }));
jest.mock("@/services/liveTvPreferences", () => ({ ...jest.requireActual("@/services/liveTvPreferences"), hideChannel: jest.fn(), renameChannel: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({
  subscribeAuthChange: jest.fn(() => () => {}),
  clearResumePosition: jest.fn(async () => {}),
  deleteItem: jest.fn(async () => {}),
  fetchIsAdministrator: jest.fn(async () => false),
  isLiveChannel: (item: { Type?: string }) => item.Type === "TvChannel",
  fetchItemDetails: jest.fn(),
  fetchFolderMediaKinds: jest.fn(async () => null),
  fetchItemFolderPath: jest.fn(async () => []),
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
}));

async function extrasFor(item: JellyfinItem): Promise<InfoExtraAction[]> {
  (fetchItemDetails as jest.Mock).mockResolvedValue(item);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<VideoInfoPanel videoId={item.Id} active />);
  });
  const rows = tree.root.findAllByType(InfoActionRow);
  const extras = (rows.at(-1)?.props.extras ?? []) as InfoExtraAction[];
  await act(async () => tree.unmount());
  return extras;
}

type Button = { text: string; onPress?: (text?: string) => void };

describe("Video info panel: hide and rename a channel", () => {
  beforeEach(() => jest.clearAllMocks());

  it("offers Rename and Hide on a channel and neither on a film", async () => {
    expect((await extrasFor(channel)).map((action) => action.key)).toEqual(["rename", "hide"]);
    expect((await extrasFor(film)).map((action) => action.key)).toEqual([]);
  });

  it("saves the typed name and drops the cached lists", async () => {
    const prompt = jest.spyOn(Alert, "prompt").mockImplementation(() => {});
    const rename = (await extrasFor(channel)).find((action) => action.key === "rename")!;
    rename.onPress();
    expect(prompt).toHaveBeenCalledWith("liveTv.renameChannel", "liveTv.renameChannelBody", expect.any(Array), "plain-text", "Channel One");
    const save = (prompt.mock.calls[0][2] as Button[]).find((button) => button.text === "common.save")!;
    save.onPress?.(" Channel Uno ");
    expect(renameChannel).toHaveBeenCalledWith(expect.objectContaining({ Id: "ch-1" }), " Channel Uno ");
    expect(invalidateChannelListReads).toHaveBeenCalledTimes(1);
  });

  it("asks before hiding, then hides, drops the cached lists and closes the panel", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const hide = (await extrasFor(channel)).find((action) => action.key === "hide")!;
    hide.onPress();
    expect(alert).toHaveBeenCalledWith("Channel One", "liveTv.hideChannelBody", expect.any(Array));
    expect(hideChannel).not.toHaveBeenCalled();
    const confirm = (alert.mock.calls[0][2] as Button[]).find((button) => button.text === "liveTv.hideChannel")!;
    confirm.onPress?.();
    expect(hideChannel).toHaveBeenCalledWith(expect.objectContaining({ Id: "ch-1" }));
    expect(invalidateChannelListReads).toHaveBeenCalledTimes(1);
    expect(mockRouter.back).toHaveBeenCalledTimes(1);
  });
});
