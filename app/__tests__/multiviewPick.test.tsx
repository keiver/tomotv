/** The Multiview channel picker: the wall's channels, and the pressed one fills the spot it was opened for, then the screen goes back. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
const mockUpdate = jest.fn();
let mockStored = { layout: "onePlusThree", spots: ["a", "b", "c", null], chosen: ["a"], strip: true };
const mockWall = [
  { Id: "c", Name: "C" },
  { Id: "d", Name: "D" },
];

jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }), useLocalSearchParams: () => mockParams }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ autoUpdate: true }) }));
jest.mock("@/hooks/useChannelWall", () => ({ useChannelWall: () => ({ wall: mockWall, isLoading: false, isLoadingMore: false, hasMore: false, error: null, loadMore: jest.fn(), retry: jest.fn() }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/liveTvPreferences", () => ({ getLiveTvPreferences: () => ({ multiview: mockStored }), updateLiveTvPreferences: (patch: object) => mockUpdate(patch) }));
jest.mock("@/components/library-grid", () => ({ LibraryGrid: () => null }));

import MultiviewPickScreen from "@/app/multiview-pick";
import { LibraryGrid } from "@/components/library-grid";

function pressIn(spot: string | undefined, channelId: string) {
  mockParams = spot === undefined ? {} : { spot };
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MultiviewPickScreen />);
  });
  const grid = tree.root.findByType(LibraryGrid);
  expect(grid.props.items).toBe(mockWall);
  act(() => grid.props.onItemPress(mockWall.find((channel) => channel.Id === channelId)));
  act(() => tree.unmount());
}

beforeEach(() => {
  jest.clearAllMocks();
  mockStored = { layout: "onePlusThree", spots: ["a", "b", "c", null], chosen: ["a"], strip: true };
});

describe("Multiview channel picker", () => {
  it("fills the empty spot it was opened for with the pressed channel, marks it the viewer's pick, and goes back", () => {
    pressIn("3", "d");
    expect(mockUpdate).toHaveBeenCalledWith({ multiview: { ...mockStored, spots: ["a", "b", "c", "d"], chosen: ["a", "d"] } });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("trades places with the spot already showing the pressed channel", () => {
    pressIn("1", "c");
    expect(mockUpdate.mock.calls[0][0].multiview.spots).toEqual(["a", "c", "b", null]);
  });

  it("fills the first spot when the spot it names is not a number", () => {
    pressIn("x", "d");
    expect(mockUpdate.mock.calls[0][0].multiview.spots).toEqual(["d", "b", "c", null]);
  });
});
