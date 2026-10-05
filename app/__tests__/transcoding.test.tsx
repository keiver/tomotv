/** The Server transcoding page: three levels with the chosen one ticked, a press applies at once, and the server's own setting closing the section. */
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import TranscodingScreen from "@/app/transcoding";
import { COLORS } from "@/constants/colors";
import { getUiPreferences, updateUiPreferences } from "@/services/uiPreferences";
import { refreshTranscodePermissions } from "@/services/jellyfin/transcodePermissions";

jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/StreamingQuality", () => ({ StreamingQuality: () => null }));

let mockPermissions: { server: string; video: boolean; audio: boolean } | null = null;
jest.mock("@/services/jellyfin/transcodePermissions", () => ({
  refreshTranscodePermissions: jest.fn(async () => {}),
  getTranscodePermissions: () => mockPermissions,
  subscribeTranscodePermissions: () => () => {},
}));

type MockRowProps = { title: string; subtitle?: string; onPress?: () => void; trailingIcon?: unknown; disabled?: boolean; isLast?: boolean };
jest.mock("@/components/settings/ListRow", () => ({
  ListRow: ({ title, subtitle, onPress, trailingIcon, disabled, isLast }: MockRowProps) => {
    const { Text } = require("react-native");
    return (
      <Text testID={`row:${title}`} accessibilityState={{ checked: !!trailingIcon, disabled: !!disabled }} accessibilityHint={subtitle} isLast={!!isLast} onPress={onPress}>
        {title}
      </Text>
    );
  },
}));

const row = (tree: TestRenderer.ReactTestRenderer, title: string) => tree.root.findByProps({ testID: `row:${title}` });
const ticked = (tree: TestRenderer.ReactTestRenderer, title: string) => row(tree, title).props.accessibilityState.checked;
const titles = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.type === "string" && String(node.props.testID ?? "").startsWith("row:")).map((node) => node.props.testID.slice(4));

type Run = string | React.ReactElement<{ children: string; style: { color: string } }>;
/** The footer sentence and the ink on its state word; empty when there is none. */
const footer = (tree: TestRenderer.ReactTestRenderer) => {
  const sentence = tree.root.findAll((node) => node.type === Text && Array.isArray(node.props.children))[0];
  if (!sentence) return { text: "", ink: null };
  const runs: Run[] = sentence.props.children;
  const state = runs.find((run): run is Exclude<Run, string> => typeof run !== "string");
  return { text: runs.map((run) => (typeof run === "string" ? run : run.props.children)).join(""), ink: state?.props.style.color ?? null };
};

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount() {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(<TranscodingScreen />);
  });
  mounted.push(tree!);
  return tree!;
}

const LEVELS = ["When needed", "Only for unsupported files", "Off"];

describe("Server transcoding page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissions = null;
    updateUiPreferences({ serverTranscoding: "linkOrFile" });
  });

  afterEach(() => {
    act(() => mounted.splice(0).forEach((tree) => tree.unmount()));
  });

  it("lists the three levels with the device's choice ticked, and asks the server for its setting", () => {
    const tree = mount();
    expect(titles(tree)).toEqual(LEVELS);
    expect(ticked(tree, "When needed")).toBe(true);
    expect(ticked(tree, "Off")).toBe(false);
    expect(refreshTranscodePermissions).toHaveBeenCalledTimes(1);
  });

  it("applies a press at once and moves the tick", () => {
    const tree = mount();
    act(() => row(tree, "Off").props.onPress());
    expect(getUiPreferences().serverTranscoding).toBe("never");
    expect(ticked(tree, "Off")).toBe(true);
    expect(ticked(tree, "When needed")).toBe(false);
  });

  it("says nothing about the server until its setting is read", () => {
    expect(footer(mount()).text).toBe("");
  });

  it("closes the card with the last row until the server is read, and with the footer after", () => {
    const unread = mount();
    expect(row(unread, "Off").props.isLast).toBe(true);
    mockPermissions = { server: "http://a:8096", video: true, audio: true };
    expect(row(mount(), "Off").props.isLast).toBe(false);
  });

  it("closes the section with the server's setting, and leaves the levels to choose", () => {
    mockPermissions = { server: "http://a:8096", video: true, audio: true };
    const tree = mount();
    expect(titles(tree)).toEqual(LEVELS);
    expect(footer(tree)).toEqual({ text: "Your server has video and audio transcoding enabled.", ink: COLORS.SUCCESS });
    expect(row(tree, "Only for unsupported files").props.accessibilityState.disabled).toBe(false);
  });

  it("disables the levels the server overrules when it turned video transcoding off", () => {
    mockPermissions = { server: "http://a:8096", video: false, audio: true };
    const tree = mount();
    expect(footer(tree)).toEqual({ text: "Your server has video transcoding disabled.", ink: COLORS.DESTRUCTIVE_SOFT });
    for (const level of LEVELS) expect(row(tree, level).props.accessibilityState.disabled).toBe(true);
  });

  it("leaves the levels to choose when the server turned off audio alone", () => {
    mockPermissions = { server: "http://a:8096", video: true, audio: false };
    const tree = mount();
    expect(footer(tree)).toEqual({ text: "Your server has audio transcoding disabled.", ink: COLORS.DESTRUCTIVE_SOFT });
    expect(row(tree, "When needed").props.accessibilityState.disabled).toBe(false);
  });
});
