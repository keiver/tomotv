/** The pinned channel marked on its own card in the guide's list. */
import { GuideLiveMark } from "@/components/live-tv/guide-live-mark";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/hooks/useCardPalette", () => ({ useCardPalette: () => ({ accent: "#ffc312", onAccent: "#000000" }) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

describe("GuideLiveMark", () => {
  it("shows a speaker badge in the theme's accent, never covering the card, and says it plays at the top to VoiceOver", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<GuideLiveMark />);
    });
    const badge = renderer.root.findByProps({ testID: "guide-live-mark" }).props;
    expect(badge.accessibilityLabel).toBe("liveTv.playingPinned");
    expect(badge.pointerEvents).toBe("none");
    const style = Object.assign({}, ...[badge.style].flat());
    expect(style.backgroundColor).toBe("#ffc312");
    expect(style.bottom).toBeUndefined();
    await act(async () => renderer.unmount());
  });
});
