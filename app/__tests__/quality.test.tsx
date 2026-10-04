/** The merged Streaming page keeps quality choices behind the device and server permissions. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ScrollView, StyleSheet } from "react-native";
import * as SecureStore from "expo-secure-store";
import QualityScreen from "@/app/quality";
import { LinkSpeedHeading } from "@/components/settings/LinkSpeedHeading";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { QUALITY_ROW_HEIGHT } from "@/components/settings/styles";
import { measureIfIdle, rememberedBitrateStatus } from "@/services/jellyfin/bitrateTest";
import { updateUiPreferences } from "@/services/uiPreferences";

jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/settings/LinkLadder", () => ({ LinkLadder: () => null }));
jest.mock("@/components/settings/QualityMark", () => ({ QualityMark: () => null }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));
jest.mock("@/services/jellyfin/bitrateTest", () => ({
  rememberedBitrateStatus: jest.fn(async () => null),
  measureIfIdle: jest.fn(async () => null),
}));

let mockPermissions: { server: string; video: boolean; audio: boolean } | null = null;
jest.mock("@/services/jellyfin/transcodePermissions", () => ({
  refreshTranscodePermissions: jest.fn(async () => {}),
  getTranscodePermissions: () => mockPermissions,
  subscribeTranscodePermissions: () => () => {},
}));

jest.mock("@/components/settings/ListRow", () => ({
  ListRow: ({ title, subtitle, onPress, trailingIcon }: { title: string; subtitle?: string; onPress: () => void; trailingIcon?: unknown }) => {
    const { Text } = require("react-native");
    return <Text testID={`row:${title}`} subtitle={subtitle} accessibilityState={{ checked: !!trailingIcon }} onPress={onPress} />;
  },
}));

jest.mock("@/components/settings/LinkSpeedHeading", () => ({ LinkSpeedHeading: () => null }));

const row = (tree: TestRenderer.ReactTestRenderer, title: string) => tree.root.findByProps({ testID: `row:${title}` });
const ticked = (tree: TestRenderer.ReactTestRenderer, title: string) => row(tree, title).props.accessibilityState.checked;

const mounted: TestRenderer.ReactTestRenderer[] = [];

async function mount() {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<QualityScreen />);
  });
  mounted.push(tree!);
  return tree!;
}

describe("Streaming quality", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissions = null;
    updateUiPreferences({ serverTranscoding: "linkOrFile" });
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (rememberedBitrateStatus as jest.Mock).mockResolvedValue(null);
    (measureIfIdle as jest.Mock).mockResolvedValue(null);
  });

  afterEach(() => {
    act(() => mounted.splice(0).forEach((tree) => tree.unmount()));
  });

  it.each(["linkOrFile", "fileOnly"] as const)("shows quality when transcoding is %s", async (serverTranscoding) => {
    updateUiPreferences({ serverTranscoding });
    const tree = await mount();
    expect(row(tree, "Auto")).toBeDefined();
  });

  it("hides quality and skips its measurement when transcoding is off", async () => {
    updateUiPreferences({ serverTranscoding: "never" });
    const tree = await mount();
    expect(tree.root.findAllByProps({ testID: "row:Auto" })).toHaveLength(0);
    expect(measureIfIdle).not.toHaveBeenCalled();
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("restores the saved quality when transcoding is re-enabled", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("3");
    const tree = await mount();
    expect(ticked(tree, "Up to 1080p")).toBe(true);

    await act(async () => row(tree, "Never").props.onPress());
    expect(tree.root.findAllByProps({ testID: "row:Up to 1080p" })).toHaveLength(0);

    await act(async () => row(tree, "Only for files this device can't play").props.onPress());
    expect(ticked(tree, "Up to 1080p")).toBe(true);
    expect(SecureStore.setItemAsync).not.toHaveBeenCalled();
  });

  it("hides quality when the server forbids video transcoding", async () => {
    mockPermissions = { server: "http://a:8096", video: false, audio: true };
    const tree = await mount();
    expect(tree.root.findAllByProps({ testID: "row:Auto" })).toHaveLength(0);
    expect(measureIfIdle).not.toHaveBeenCalled();
  });

  it("keeps video quality available when only audio transcoding is forbidden", async () => {
    mockPermissions = { server: "http://a:8096", video: true, audio: false };
    const tree = await mount();
    expect(row(tree, "Auto")).toBeDefined();
  });

  it("ticks the saved preset and lists every rung under it", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("3");
    const tree = await mount();
    expect(ticked(tree, "Up to 1080p")).toBe(true);
    expect(ticked(tree, "Auto")).toBe(false);
    expect(row(tree, "Auto").props.subtitle).toBe("Adjusts to your connection");
  });

  it("shows five rows at a time, keeping all presets scrollable and the footer outside the list", async () => {
    const tree = await mount();
    const list = tree.root.findAllByType(ScrollView).find((node) => node.props.onContentSizeChange)!;
    expect(StyleSheet.flatten(list.props.style).height).toBe(QUALITY_ROW_HEIGHT * 5);
    expect(list.findAll((node) => typeof node.type === "string" && String(node.props.testID ?? "").startsWith("row:"))).toHaveLength(6);
    expect(list.findAllByType(SectionFooter)).toHaveLength(0);

    // Larger text changes row height without changing the five-row cap.
    act(() => list.props.onContentSizeChange(400, 6 * 90));
    expect(StyleSheet.flatten(list.props.style).height).toBe(5 * 90);
  });

  it("saves a press at once and moves the tick", async () => {
    const tree = await mount();
    expect(ticked(tree, "Auto")).toBe(true);
    await act(async () => row(tree, "Up to 720p").props.onPress());
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("app_video_quality", "2");
    expect(ticked(tree, "Up to 720p")).toBe(true);
    expect(ticked(tree, "Auto")).toBe(false);
  });

  it("keeps the choice descriptions stable when the connection measurement changes", async () => {
    (rememberedBitrateStatus as jest.Mock).mockResolvedValue({ bps: 10_000_000, fresh: true });
    const fresh = await mount();
    expect(row(fresh, "Auto").props.subtitle).toBe("Adjusts to your connection");
    expect(row(fresh, "Up to 4K").props.subtitle).toBe("Best detail, highest data use");
    expect(measureIfIdle).not.toHaveBeenCalled();

    (rememberedBitrateStatus as jest.Mock).mockResolvedValue({ bps: 10_000_000, fresh: false });
    (measureIfIdle as jest.Mock).mockResolvedValue(80_000_000);
    const stale = await mount();
    expect(measureIfIdle).toHaveBeenCalledTimes(1);
    expect(row(stale, "Auto").props.subtitle).toBe("Adjusts to your connection");
    expect(row(stale, "Up to 4K").props.subtitle).toBe("Best detail, highest data use");
  });

  it("labels the section as transcoding quality without a link probe heading", async () => {
    const tree = await mount();
    expect(tree.root.findByProps({ accessibilityRole: "header" }).props.children).toBe("TRANSCODING QUALITY");
    expect(tree.root.findAllByType(LinkSpeedHeading)).toHaveLength(0);
  });
});
