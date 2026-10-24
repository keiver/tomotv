/** A channel on a home shelf is named by its channel, so its tab says CHANNEL, never the airing programme's NOW. */
import { ItemShelf } from "@/components/item-shelf";
import type { JellyfinItem } from "@/types/jellyfin";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const rendered: { hideAiring?: boolean }[] = [];

jest.mock("expo-router", () => ({ useFocusEffect: (effect: () => void | (() => void)) => require("react").useEffect(effect, [effect]) }));
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => jest.fn() }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => jest.fn() }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({}) }));
jest.mock("@/services/liveTvPreferences", () => ({ isFavoriteChannel: () => false }));
jest.mock("@/services/jellyfinApi", () => ({ isFolder: () => false, subscribeFavoriteChange: () => () => {} }));
jest.mock("@/components/card-badge", () => ({ channelFavoriteIcon: () => undefined }));
jest.mock("@/components/folder-grid-item", () => ({ FolderGridItem: () => null }));
jest.mock("@/components/video-grid-item", () => ({
  VideoGridItem: (props: { hideAiring?: boolean }) => {
    rendered.push(props);
    return null;
  },
}));
jest.mock("@/components/media-shelf", () => ({
  MediaShelf: ({ data, renderItem }: { data: JellyfinItem[]; renderItem: (item: JellyfinItem, index: number, height: number) => React.ReactNode }) => (
    <>{data.map((item, index) => renderItem(item, index, 200))}</>
  ),
}));

it("titles a channel card by the channel's own name, not the programme airing on it", async () => {
  const channel = { Id: "c1", Name: "Village TV", Type: "TvChannel", CurrentProgram: { Name: "Veguitas" } } as unknown as JellyfinItem;
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<ItemShelf title="Favorites" fetch={async () => [channel]} />);
    await new Promise((resolve) => setImmediate(resolve));
  });
  expect(rendered.at(-1)).toMatchObject({ hideAiring: true });
  act(() => tree.unmount());
});
