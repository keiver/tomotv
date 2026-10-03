/** The Quality page: the saved preset ticked, a press saves at once, the connection measured when the memory is stale. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import * as SecureStore from "expo-secure-store";
import QualityScreen from "@/app/quality";
import { measureIfIdle, remeasureBitrate, rememberedBitrateStatus } from "@/services/jellyfin/bitrateTest";

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
  remeasureBitrate: jest.fn(async () => null),
}));

jest.mock("@/components/settings/LinkSpeedHeading", () => ({
  LinkSpeedHeading: ({ measuredBps, measuring, onRemeasure }: { measuredBps: number | null; measuring: boolean; onRemeasure: () => void }) => {
    const { Text } = require("react-native");
    return <Text testID="heading" measuredBps={measuredBps} measuring={measuring} onPress={onRemeasure} />;
  },
}));

jest.mock("@/components/settings/ListRow", () => ({
  ListRow: ({ title, subtitle, onPress, trailingIcon }: { title: string; subtitle?: string; onPress: () => void; trailingIcon?: unknown }) => {
    const { Text } = require("react-native");
    return <Text testID={`row:${title}`} subtitle={subtitle} accessibilityState={{ checked: !!trailingIcon }} onPress={onPress} />;
  },
}));

const row = (tree: TestRenderer.ReactTestRenderer, title: string) => tree.root.findByProps({ testID: `row:${title}` });
const ticked = (tree: TestRenderer.ReactTestRenderer, title: string) => row(tree, title).props.accessibilityState.checked;
const heading = (tree: TestRenderer.ReactTestRenderer) => tree.root.findByProps({ testID: "heading" }).props;

async function mount() {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  await act(async () => {
    tree = TestRenderer.create(<QualityScreen />);
  });
  return tree!;
}

describe("Quality page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
    (rememberedBitrateStatus as jest.Mock).mockResolvedValue(null);
    (measureIfIdle as jest.Mock).mockResolvedValue(null);
  });

  it("ticks the saved preset and lists every rung under it", async () => {
    (SecureStore.getItemAsync as jest.Mock).mockResolvedValue("3");
    const tree = await mount();
    expect(ticked(tree, "Up to 1080p")).toBe(true);
    expect(ticked(tree, "Auto")).toBe(false);
    expect(row(tree, "Auto").props.subtitle).toBe("Adapts as it plays");
  });

  it("saves a press at once and moves the tick", async () => {
    const tree = await mount();
    expect(ticked(tree, "Auto")).toBe(true);
    await act(async () => row(tree, "Up to 720p").props.onPress());
    expect(SecureStore.setItemAsync).toHaveBeenCalledWith("app_video_quality", "2");
    expect(ticked(tree, "Up to 720p")).toBe(true);
    expect(ticked(tree, "Auto")).toBe(false);
  });

  it("shows the remembered reading and measures again only when it is stale", async () => {
    (rememberedBitrateStatus as jest.Mock).mockResolvedValue({ bps: 50_000_000, fresh: true });
    const fresh = await mount();
    expect(heading(fresh).measuredBps).toBe(50_000_000);
    expect(measureIfIdle).not.toHaveBeenCalled();

    (rememberedBitrateStatus as jest.Mock).mockResolvedValue({ bps: 50_000_000, fresh: false });
    (measureIfIdle as jest.Mock).mockResolvedValue(80_000_000);
    const stale = await mount();
    expect(measureIfIdle).toHaveBeenCalledTimes(1);
    expect(heading(stale).measuredBps).toBe(80_000_000);
    expect(heading(stale).measuring).toBe(false);
  });

  it("measures afresh from the heading", async () => {
    (remeasureBitrate as jest.Mock).mockResolvedValue(12_000_000);
    const tree = await mount();
    await act(async () => heading(tree).onPress());
    expect(remeasureBitrate).toHaveBeenCalledTimes(1);
    expect(heading(tree).measuredBps).toBe(12_000_000);
  });
});
