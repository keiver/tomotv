/** Signed out, the Live TV tab shows the Who's watching screen and never loads a guide. */
import LiveTvRoute from "@/app/live-tv";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockAuth = { isConnected: false, isReady: true };
jest.mock("@/contexts/AuthContext", () => ({ useAuth: () => mockAuth }));
jest.mock("@/components/settings/WhoIsWatchingScreen", () => ({ WhoIsWatchingScreen: () => null }));
jest.mock("@/hooks/useGuide", () => ({ useGuide: jest.fn(), invalidateGuideReads: jest.fn() }));
jest.mock("@/components/live-tv/guide-canvas", () => ({ GuideCanvas: () => null }));
jest.mock("@/components/live-tv/guide-hud", () => ({ GuideHud: () => null }));
jest.mock("@/components/live-tv/guide-corner-actions", () => ({ GuideCornerActions: () => null, HudAction: () => null, HUD_ACTION_ICON: 20 }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));
jest.mock("@/services/jellyfinApi", () => ({ lastKnownTunerData: () => null }));
jest.mock("@/services/externalGuide", () => ({ refreshExternalGuide: jest.fn(), activeGuideUrls: () => [] }));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({}), useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));

const { WhoIsWatchingScreen } = jest.requireMock("@/components/settings/WhoIsWatchingScreen") as { WhoIsWatchingScreen: React.ComponentType };
const { useGuide } = jest.requireMock("@/hooks/useGuide") as { useGuide: jest.Mock };

describe("Live TV route", () => {
  it("shows Who's watching signed out and never loads the guide", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<LiveTvRoute />);
    });
    expect(renderer.root.findByType(WhoIsWatchingScreen).props).toEqual({ title: "liveTv.title" });
    expect(useGuide).not.toHaveBeenCalled();
  });

  it("renders nothing until auth has read its state", async () => {
    mockAuth.isReady = false;
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<LiveTvRoute />);
    });
    expect(renderer.toJSON()).toBeNull();
    mockAuth.isReady = true;
  });
});
