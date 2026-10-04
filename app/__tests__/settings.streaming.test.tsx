import React from "react";
import { StyleSheet, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import SettingsScreen from "@/app/(tabs)/settings";
import { LinkSpeedHeading } from "@/components/settings/LinkSpeedHeading";
import { COLORS } from "@/constants/colors";
import { measureIfIdle, remeasureBitrate, rememberedBitrateStatus } from "@/services/jellyfin/bitrateTest";
import { updateUiPreferences } from "@/services/uiPreferences";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (effect: () => (() => void) | undefined) => {
    const React = require("react");
    React.useEffect(effect, [effect]);
  },
}));
jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async (key: string) => {
    const values: Record<string, string> = { jellyfin_server_url: "http://a:8096", jellyfin_api_key: "test-key", jellyfin_user_id: "test-user" };
    return values[key];
  }),
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/brand-corners", () => ({ BrandCorners: () => null }));
jest.mock("@/components/settings/AboutSection", () => ({ AboutSection: () => null }));
jest.mock("@/components/settings/UiSection", () => ({ UiSection: () => null }));
jest.mock("@/components/settings/ServerConnectFlow", () => ({ ServerConnectFlow: () => null }));
jest.mock("@/components/settings/ConnectedSection", () => ({ ConnectedSection: () => null }));
jest.mock("@/components/settings/ServerRow", () => ({ SERVER_GLYPH: "server" }));
jest.mock("@/components/settings/ListRow", () => ({
  ListRow: ({ title, onPress }: { title: string; onPress: () => void }) => {
    const { Text } = require("react-native");
    return <Text testID={`row:${title}`} onPress={onPress} />;
  },
}));
jest.mock("@/services/jellyfinApi", () => ({
  getStoredUserName: jest.fn(async () => "Test viewer"),
  getUserImageUrl: jest.fn(),
  isAuthenticated: () => true,
  isDemoMode: jest.fn(async () => false),
  subscribeAuthChange: () => () => {},
}));
jest.mock("@/services/syncPlayManager", () => ({ refreshAccess: jest.fn(async () => {}), subscribe: () => () => {} }));
jest.mock("@/services/diagnosticsInbox", () => ({ pokeInbox: jest.fn() }));
jest.mock("@/services/jellyfin/transcodePermissions", () => ({
  refreshTranscodePermissions: jest.fn(async () => {}),
  getTranscodePermissions: () => null,
  subscribeTranscodePermissions: () => () => {},
}));
jest.mock("@/services/jellyfin/bitrateTest", () => ({
  rememberedBitrateStatus: jest.fn(),
  measureIfIdle: jest.fn(),
  remeasureBitrate: jest.fn(),
}));

const mounted: TestRenderer.ReactTestRenderer[] = [];
const text = (tree: TestRenderer.ReactTestRenderer, value: string) => tree.root.findAllByType(Text).find((node) => node.props.children === value);

async function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<SettingsScreen />);
  });
  mounted.push(tree);
  return tree;
}

describe("Settings streaming header", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateUiPreferences({ serverTranscoding: "never" });
    (rememberedBitrateStatus as jest.Mock).mockResolvedValue({ bps: 50_000_000, fresh: true });
    (measureIfIdle as jest.Mock).mockResolvedValue(null);
    (remeasureBitrate as jest.Mock).mockResolvedValue(12_000_000);
  });

  afterEach(() => {
    act(() => mounted.splice(0).forEach((tree) => tree.unmount()));
  });

  it("shows the green speed beside STREAMING even when transcoding is off, with one settings destination", async () => {
    const tree = await mount();
    const heading = tree.root.findByType(LinkSpeedHeading);
    expect(heading.props.measuredBps).toBe(50_000_000);
    expect(text(tree, "STREAMING")).toBeDefined();
    expect(StyleSheet.flatten(text(tree, "50 MBPS")!.props.style).color).toBe(COLORS.SUCCESS);
    expect(tree.root.findAllByProps({ testID: "row:Quality" })).toHaveLength(0);
    await act(async () => tree.root.findByProps({ testID: "row:Server transcoding" }).props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/transcoding");
    expect(measureIfIdle).not.toHaveBeenCalled();
  });

  it("updates a stale reading on the main Settings screen", async () => {
    (rememberedBitrateStatus as jest.Mock).mockResolvedValue({ bps: 50_000_000, fresh: false });
    (measureIfIdle as jest.Mock).mockResolvedValue(80_000_000);
    const tree = await mount();
    expect(measureIfIdle).toHaveBeenCalledTimes(1);
    expect(text(tree, "80 MBPS")).toBeDefined();
  });

  it("remeasures when the main streaming heading is pressed", async () => {
    const tree = await mount();
    await act(async () => tree.root.findByType(LinkSpeedHeading).findByProps({ accessibilityRole: "button" }).props.onPress());
    expect(remeasureBitrate).toHaveBeenCalledTimes(1);
    expect(text(tree, "12 MBPS")).toBeDefined();
  });
});
