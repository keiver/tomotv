/** The Multiview layout picker: every layout drawn in the Multiview screen's shape, the current one marked and focused, a pressed one applied around the first spot's channel before the screen goes back. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { MultiviewArrangement } from "@/services/liveTvPreferences";

const mockBack = jest.fn();
const mockUpdate = jest.fn();
let mockArrangement: MultiviewArrangement;
const mockUnavailable = new Set<string>();
const mockWall = Array.from({ length: 10 }, (_, i) => ({ Id: `c${i}`, Name: `Channel ${i}` }));

jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ autoUpdate: true, multiview: mockArrangement }) }));
jest.mock("@/hooks/useChannelWall", () => ({ useChannelWall: () => ({ wall: mockWall }) }));
jest.mock("@/services/liveTvPreferences", () => ({ updateLiveTvPreferences: (patch: object) => mockUpdate(patch) }));
jest.mock("@/services/liveTiles", () => ({ liveTileUnavailable: (id: string) => mockUnavailable.has(id) }));
jest.mock("@keiver/tomo-live", () => jest.requireActual("@keiver/tomo-live/src/multiviewLayout"));
jest.mock("@/components/live-tv/multiview-layout-option", () => ({ MultiviewLayoutOption: () => null }));

import MultiviewLayoutScreen from "@/app/multiview-layout";
import { MultiviewLayoutOption } from "@/components/live-tv/multiview-layout-option";

type OptionProps = React.ComponentProps<typeof MultiviewLayoutOption>;
function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<MultiviewLayoutScreen />);
  });
  return tree.root.findAllByType(MultiviewLayoutOption).map((node) => node.props as OptionProps);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUnavailable.clear();
  mockArrangement = { layout: "bigThree", spots: ["c5", "c4", "c6", "c7"], chosen: ["c5"] };
});

describe("Multiview layout picker", () => {
  it("draws every layout once, the current one marked and holding focus", () => {
    const options = mount();
    expect(options.map((option) => option.layout)).toEqual(["bigThree", "bigTwo", "grid4", "rowThree", "halvesTwo", "halvesThree"]);
    expect(options.filter((option) => option.current).map((option) => option.layout)).toEqual(["bigThree"]);
    expect(options.filter((option) => option.hasTVPreferredFocus).map((option) => option.layout)).toEqual(["bigThree"]);
  });

  it("applies a pressed layout around the first spot's channel and goes back", () => {
    const options = mount();
    act(() => options[3].onPress("rowThree"));
    expect(mockUpdate).toHaveBeenCalledWith({ multiview: { layout: "rowThree", spots: ["c5", "c4", "c6", "c7", null, null], chosen: ["c5"] } });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it("fills new live spots with no channel that cannot fill a spot on its own", () => {
    mockArrangement = { layout: "bigTwo", spots: [null, "c3", null], chosen: ["c3"] };
    mockUnavailable.add("c0");
    const options = mount();
    act(() => options[2].onPress("grid4"));
    expect(mockUpdate.mock.calls[0][0].multiview.spots).toEqual(["c3", "c1", "c2", "c4"]);
  });

  it("draws each layout in the shape of the Multiview screen, the window under the bar", () => {
    const options = mount();
    expect(options.every((option) => option.stage.width > 0 && option.stage.height > 0)).toBe(true);
  });

  it("goes back without writing when the current layout is pressed", () => {
    const options = mount();
    act(() => options[0].onPress("bigThree"));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
