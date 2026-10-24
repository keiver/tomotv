/** The wall's band: + for a new group, then the groups, one picked. */
import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockPrompt = jest.fn();
const mockUpdate = jest.fn();

jest.mock("@/components/live-tv/channel-group-prompt", () => ({ promptChannelGroup: (...args: unknown[]) => mockPrompt(...args) }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#FFC312", ink: "#000" }), themedStyles: () => () => ({}) }));
jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => ({ filter: "group:g1" }) }));
jest.mock("@/hooks/useChannelFilterChoices", () => ({
  useChannelFilterChoices: () => [
    { filter: "all", label: "All" },
    { filter: "group:g1", label: "News" },
  ],
}));
jest.mock("@/services/liveFrames", () => ({ LIVE_FRAME_REFRESH_MS: 120_000, LIVE_FRAME_TRANSITION_MS: 400 }));
jest.mock("@/services/liveTvPreferences", () => ({ updateLiveTvPreferences: (...args: unknown[]) => mockUpdate(...args) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/components/sf-symbol-icon", () => ({ SfSymbolIcon: () => null }));
jest.mock("@/components/live-tv/recording-pulse", () => ({ RecordingPulse: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

import { GuideGroupCell } from "@/components/live-tv/guide-group-cell";
import { HudAction } from "@/components/live-tv/guide-corner-actions";
import { WallGroupsBand } from "@/components/live-tv/wall-groups-band";

function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<WallGroupsBand />);
  });
  return tree;
}

beforeEach(() => {
  mockPrompt.mockClear();
  mockUpdate.mockClear();
});

test("leads with the new group button, then the groups", () => {
  const tree = render();
  const texts = tree.root.findAllByType(Text).map((node) => node.props.children);
  expect(texts).toEqual(["liveTv.newGroup", "All", "News"]);
  act(() => tree.unmount());
});

test("+ opens the new group name prompt with no channel", () => {
  const tree = render();
  act(() => tree.root.findByType(HudAction).props.onPress());
  expect(mockPrompt).toHaveBeenCalledWith();
  act(() => tree.unmount());
});

test("the band is a pill, its + cell rounded on the left so the focus ring follows the curve", () => {
  const tree = render();
  const pill = tree.root.findAll((node) => node.props.testID === "wall-groups-pill" && typeof node.type === "string")[0];
  expect(StyleSheet.flatten(pill.props.style)).toMatchObject({ borderRadius: 20, overflow: "hidden" });
  expect(tree.root.findByType(HudAction).props).toMatchObject({ topLeftRadius: 20, bottomLeftRadius: 20 });
  act(() => tree.unmount());
});

test("marks the picked group, and a press picks another", () => {
  const tree = render();
  const cells = tree.root.findAllByType(GuideGroupCell);
  expect(cells.map((cell) => cell.props.selected)).toEqual([false, true]);
  act(() => cells[0].props.onPress());
  expect(mockUpdate).toHaveBeenCalledWith({ filter: "all" });
  act(() => tree.unmount());
});
