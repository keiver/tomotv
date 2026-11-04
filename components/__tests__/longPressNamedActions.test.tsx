import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/components/MarqueeText", () => {
  const { Text } = require("react-native");
  return { MarqueeText: ({ children, style }: { children: React.ReactNode; style: object }) => <Text style={style}>{children}</Text> };
});
jest.mock("@/components/live-tv/live-clip", () => ({ LiveClip: () => null }));
jest.mock("@/components/live-tv/live-freshness-badge", () => ({ LiveFreshnessBadge: () => null, LIVE_FRESH_MS: 15_000 }));
jest.mock("@/components/poster-collage", () => ({ PosterCollage: () => null }));
jest.mock("@/hooks/useItemPoster", () => ({ useItemPoster: () => undefined }));
jest.mock("@/hooks/useMinuteClock", () => ({ useMinuteClock: () => 0 }));
jest.mock("@/hooks/useNowPlaying", () => ({ useIsNowPlaying: () => false, useNowPlayingVideo: () => ({ active: false, playing: false }), useOpenNowPlaying: () => jest.fn() }));
jest.mock("@/hooks/useCardNavProgress", () => ({ useCardNavProgress: () => ({ navigating: false, visible: false, startNavProgress: jest.fn(), resetNavProgress: jest.fn() }) }));
jest.mock("@/hooks/useFolderPreview", () => ({ useFolderPreview: () => [] }));
jest.mock("@/hooks/useViewItemCount", () => ({ useViewItemCount: () => ({ count: 3, loading: false }) }));
jest.mock("@/services/itemArtwork", () => ({ showsChannelLogo: () => false, folderPosterSource: () => undefined }));
jest.mock("@/services/liveFrames", () => ({
  LIVE_FRAME_TRANSITION_MS: 0,
  LIVE_FRAME_REFRESH_MS: 120_000,
  liveFrameReel: () => undefined,
  liveFrameDueAt: () => undefined,
  subscribeLiveFrame: () => () => undefined,
}));
jest.mock("@/services/jellyfinApi", () => ({ isAudioItem: () => false, isBook: () => false, JELLYFIN_TIME: { TICKS_PER_SECOND: 10_000_000 } }));
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: () => ({ sessionVideoId: null, hostMode: "idle", playbackState: { type: "IDLE" } }) }));
jest.mock("@/services/audioPlayerManager", () => ({ audioPlayerManager: { getUIState: () => ({ playing: false, position: 0 }), subscribe: () => () => {} } }));

import { FolderGridItem } from "@/components/folder-grid-item";
import { AccountAvatar } from "@/components/settings/AccountAvatar";
import { ServerRow } from "@/components/settings/ServerRow";
import { VideoGridItem } from "@/components/video-grid-item";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";

const movie = { Id: "m1", Name: "A Movie", Type: "Movie" } as JellyfinVideoItem;
const folder = { Id: "f1", Name: "Shows", Type: "Folder", RecursiveItemCount: 3 } as unknown as JellyfinItem;

function mount(element: React.ReactElement) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(element);
  });
  return tree;
}

const withActions = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => typeof node.props.onAccessibilityAction === "function" && Array.isArray(node.props.accessibilityActions));

function fire(tree: TestRenderer.ReactTestRenderer, actionName: string) {
  const [target] = withActions(tree);
  act(() => target.props.onAccessibilityAction({ nativeEvent: { actionName } }));
}

describe("an element with a press-and-hold also names that action for VoiceOver and Voice Control", () => {
  it("a video card offers Details, which runs its long press with the video", () => {
    const onLongPress = jest.fn();
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} onLongPress={onLongPress} index={0} />);
    expect(withActions(tree)[0].props.accessibilityActions).toEqual([{ name: "details", label: t("info.details") }]);
    fire(tree, "activate");
    expect(onLongPress).not.toHaveBeenCalled();
    fire(tree, "details");
    expect(onLongPress).toHaveBeenCalledWith(movie);
    act(() => tree.unmount());
  });

  it("a video card without a long press offers no named action", () => {
    const tree = mount(<VideoGridItem video={movie} onPress={jest.fn()} index={0} />);
    expect(withActions(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("a folder card offers Details, which runs its long press with the folder", () => {
    const onLongPress = jest.fn();
    const tree = mount(<FolderGridItem folder={folder} onPress={jest.fn()} onLongPress={onLongPress} index={0} />);
    expect(withActions(tree)[0].props.accessibilityActions).toEqual([{ name: "details", label: t("info.details") }]);
    fire(tree, "details");
    expect(onLongPress).toHaveBeenCalledWith(folder);
    act(() => tree.unmount());
  });

  it("a saved server row offers Options, which opens the same options as the long press", () => {
    const onLongPress = jest.fn();
    const tree = mount(<ServerRow variant="server" name="Home" onPress={jest.fn()} onLongPress={onLongPress} />);
    expect(withActions(tree)[0].props.accessibilityActions).toEqual([{ name: "options", label: t("common.options") }]);
    fire(tree, "options");
    expect(onLongPress).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
  });

  it("a server row without a long press offers no named action", () => {
    const tree = mount(<ServerRow variant="add" name="Add Server" onPress={jest.fn()} />);
    expect(withActions(tree)).toHaveLength(0);
    act(() => tree.unmount());
  });

  it("an account avatar offers Options, and a disabled one offers nothing", () => {
    const onLongPress = jest.fn();
    const tree = mount(<AccountAvatar label="Alex" onPress={jest.fn()} onLongPress={onLongPress} />);
    expect(withActions(tree)[0].props.accessibilityActions).toEqual([{ name: "options", label: t("common.options") }]);
    fire(tree, "options");
    expect(onLongPress).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
    const disabled = mount(<AccountAvatar label="Alex" onPress={jest.fn()} onLongPress={onLongPress} disabled />);
    expect(withActions(disabled)).toHaveLength(0);
    act(() => disabled.unmount());
  });
});
