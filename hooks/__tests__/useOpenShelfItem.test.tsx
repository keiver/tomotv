/**
 * Tests for useOpenShelfItem, the press handler behind every shelf card. A photo carries no
 * media source, so routing one to the player is what put "Unable to Play / Failed to load
 * video" on screen for a PNG that opens fine from the folder grid.
 *
 * Rendered with react-test-renderer through a null-rendering harness, the same pattern as
 * hooks/__tests__/useFolderPlay.test.tsx.
 */
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { JellyfinItem } from "@/types/jellyfin";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBuildQueue = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock("@/contexts/LoadingContext", () => ({
  useLoadingActions: () => ({ showGlobalLoader: jest.fn(), hideGlobalLoader: jest.fn() }),
}));

jest.mock("@/contexts/PlayQueueContext", () => ({
  usePlayQueue: () => ({ buildQueue: mockBuildQueue }),
}));

jest.mock("@/services/jellyfinApi", () => ({
  isAudioItem: (item: JellyfinItem) => item.Type === "Audio",
  isFolder: (item: JellyfinItem) => item.Type === "Folder" || item.Type === "Series",
  isPhoto: (item: JellyfinItem) => item.Type === "Photo",
}));

type OpenHandle = { open: (item: JellyfinItem) => void };

const Harness = forwardRef<OpenHandle>((_props, ref) => {
  const openItem = useOpenShelfItem();
  useImperativeHandle(ref, () => ({ open: openItem }), [openItem]);
  return null;
});
Harness.displayName = "Harness";

function mountHarness(): OpenHandle {
  const ref = React.createRef<OpenHandle>();
  act(() => {
    TestRenderer.create(<Harness ref={ref} />);
  });
  return ref.current!;
}

describe("useOpenShelfItem", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens a photo in the viewer over the folder it lives in", () => {
    mountHarness().open({ Id: "photo-1", Name: "reference_00011_", Type: "Photo", ParentId: "folder-1" } as JellyfinItem);

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/photo-viewer", params: { photoId: "photo-1", folderId: "folder-1" } });
    expect(mockBuildQueue).not.toHaveBeenCalled();
  });

  it("opens a parentless photo on its own rather than sending it to the player", () => {
    mountHarness().open({ Id: "photo-2", Name: "loose", Type: "Photo" } as JellyfinItem);

    expect(mockPush).toHaveBeenCalledWith({ pathname: "/photo-viewer", params: { photoId: "photo-2" } });
  });

  it("still routes a video to the player", () => {
    mountHarness().open({ Id: "movie-1", Name: "Movie", Type: "Movie", ParentId: "folder-1" } as JellyfinItem);

    expect(mockPush).toHaveBeenCalledWith(expect.objectContaining({ pathname: "/player" }));
  });
});
