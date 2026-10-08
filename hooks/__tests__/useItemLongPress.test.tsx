/** A held card opens its info panel, preserving guide-source programme metadata. */
import { useItemLongPress } from "@/hooks/useItemLongPress";
import { JellyfinItem } from "@/types/jellyfin";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockPush = jest.fn();

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
}));

type HoldHandle = { hold: (item: JellyfinItem) => void };

const Harness = forwardRef<HoldHandle, { inFolderId?: string }>(({ inFolderId }, ref) => {
  const hold = useItemLongPress(inFolderId);
  useImperativeHandle(ref, () => ({ hold }), [hold]);
  return null;
});
Harness.displayName = "Harness";

function mountHarness(inFolderId?: string): HoldHandle {
  const ref = React.createRef<HoldHandle>();
  act(() => {
    TestRenderer.create(<Harness ref={ref} inFolderId={inFolderId} />);
  });
  return ref.current!;
}

describe("useItemLongPress", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens the item's own panel, marking the folder it is viewed in", () => {
    mountHarness("folder-1").hold({ Id: "movie-1", Name: "Sintel", Type: "Movie" } as JellyfinItem);
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/video-info", params: { videoId: "movie-1", name: "Sintel", inFolderId: "folder-1" } });
  });

  it("carries a guide-source programme into its panel", () => {
    const program = { Id: "epg:tbs:1", Name: "MLB Baseball", Type: "Program", ChannelId: "tbs", ChannelName: "TBS", Overview: "Yankees at Rays." } as JellyfinItem;
    mountHarness().hold(program);
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/video-info", params: { videoId: "tbs", name: "MLB Baseball", guideProgram: JSON.stringify(program) } });
  });
});
