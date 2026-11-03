/** Live TV's PiP channel marked on its card: a spinner while it opens, the system's PiP symbol while it plays in the window. */
import { GuideLiveMark } from "@/components/live-tv/guide-live-mark";
import React from "react";
import { ActivityIndicator, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#ffc312" }) }));
const mockSymbols: string[] = [];
jest.mock("@/components/sf-symbol-icon", () => ({
  SfSymbolIcon: ({ name }: { name: string }) => {
    mockSymbols.push(name);
    return null;
  },
}));

describe("GuideLiveMark", () => {
  let renderer: TestRenderer.ReactTestRenderer;
  const mount = async (element: React.ReactElement) => {
    await act(async () => {
      renderer = TestRenderer.create(element);
    });
  };
  const cover = (state: string) => renderer.root.findByProps({ testID: `guide-live-mark-${state}` }).props;
  afterEach(async () => {
    mockSymbols.length = 0;
    await act(async () => renderer.unmount());
  });

  it("shows a spinner in the theme's accent while the channel opens, and says so only to VoiceOver", async () => {
    await mount(<GuideLiveMark state="tuning" />);
    expect(renderer.root.findByType(ActivityIndicator).props.color).toBe("#ffc312");
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    expect(cover("tuning").accessibilityLabel).toBe("liveTv.tuningIn");
  });

  it("shows the system's PiP symbol while the channel plays in the window, and says so only to VoiceOver", async () => {
    await mount(<GuideLiveMark state="pip" />);
    expect(mockSymbols).toContain("pip");
    expect(renderer.root.findAllByType(Text)).toHaveLength(0);
    expect(cover("pip").accessibilityLabel).toBe("liveTv.playingInPip");
  });
});
