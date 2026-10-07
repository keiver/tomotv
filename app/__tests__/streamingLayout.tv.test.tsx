import TranscodingScreen from "@/app/transcoding";
import { LinkSpeedHeading } from "@/components/settings/LinkSpeedHeading";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { StreamingQuality } from "@/components/settings/StreamingQuality";
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const reactNative = jest.requireActual("react-native");
  Object.defineProperty(reactNative.Platform, "isTV", { configurable: true, value: true });
  return reactNative;
});
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 20, bottom: 30, left: 0, right: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));
jest.mock("@/components/settings/LinkSpeedHeading", () => ({ LinkSpeedHeading: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/settings/LinkLadder", () => ({ LinkLadder: () => null }));
jest.mock("@/components/settings/QualityMark", () => ({ QualityMark: () => null }));
jest.mock("@/hooks/useUiPreferences", () => ({ useUiPreferences: () => ({ serverTranscoding: "linkOrFile" }) }));
jest.mock("@/hooks/useTranscodePermissions", () => ({ useTranscodePermissions: () => null }));
jest.mock("@/services/jellyfin/transcodePermissions", () => ({ refreshTranscodePermissions: jest.fn(async () => {}) }));
jest.mock("expo-secure-store", () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}) }));
jest.mock("@/services/jellyfin/bitrateTest", () => ({
  rememberedBitrateStatus: jest.fn(async () => ({ bps: 50_000_000, fresh: true })),
  measureIfIdle: jest.fn(),
  remeasureBitrate: jest.fn(),
}));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));

function layout(node: TestRenderer.ReactTestInstance, height: number, y = 0) {
  node.props.onLayout({ nativeEvent: { layout: { x: 0, y, width: 880, height } } });
}

describe("Streaming quality on TV", () => {
  let tree: TestRenderer.ReactTestRenderer;

  beforeEach(async () => {
    await act(async () => {
      tree = TestRenderer.create(<TranscodingScreen />);
    });
  });

  afterEach(() => act(() => tree.unmount()));

  it("fits whole rows below the policy controls and reserves the heading, footer, and safe areas", () => {
    const [page, list] = tree.root.findAllByType(ScrollView);
    const quality = tree.root.findByType(StreamingQuality);
    act(() => {
      layout(page, 1080);
      layout(quality.parent!, 0, 400);
      layout(quality.findByProps({ accessibilityRole: "header" }).parent!, 60);
      layout(quality.findByType(SectionFooter).parent!, 78);
      list.props.onContentSizeChange(880, 6 * 120);
    });

    expect(StyleSheet.flatten(list.props.style).height).toBe(240);
    expect(quality.findByProps({ accessibilityRole: "header" }).props.children).toBe("TRANSCODING QUALITY");
    expect(quality.findAllByType(LinkSpeedHeading)).toHaveLength(0);
    expect(list.findAllByType(ListRow)).toHaveLength(6);
    expect(list.findAllByType(SectionFooter)).toHaveLength(0);

    act(() => layout(page, 960));
    expect(StyleSheet.flatten(list.props.style).height).toBe(120);

    // Room for five rows still shows four.
    act(() => layout(page, 1440));
    expect(StyleSheet.flatten(list.props.style).height).toBe(480);

    // Wrapped footer copy also reduces the space available to the list.
    act(() => layout(quality.findByType(SectionFooter).parent!, 318));
    expect(StyleSheet.flatten(list.props.style).height).toBe(360);
  });

  it("pins the boundary rows so focus can leave the nested list", () => {
    const list = tree.root.findAllByType(ScrollView)[1];
    const scrollTo = jest.spyOn(list.instance, "scrollTo").mockImplementation(() => {});
    const scrollToEnd = jest.spyOn(list.instance, "scrollToEnd").mockImplementation(() => {});
    const rows = list.findAllByType(ListRow);

    act(() => rows[0].props.onFocus());
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: false });
    act(() => rows[rows.length - 1].props.onFocus());
    expect(scrollToEnd).toHaveBeenCalledWith({ animated: false });
  });
});
