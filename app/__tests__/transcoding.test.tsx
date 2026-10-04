/** The Server transcoding page: the server's own setting stated first, three levels with the chosen one ticked, a press applies at once. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import TranscodingScreen from "@/app/transcoding";
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

type MockRowProps = { title: string; subtitle?: string; onPress?: () => void; trailingIcon?: unknown; disabled?: boolean; tone?: string };
jest.mock("@/components/settings/ListRow", () => ({
  ListRow: ({ title, subtitle, onPress, trailingIcon, disabled, tone }: MockRowProps) => {
    const { Text } = require("react-native");
    return (
      <Text testID={`row:${title}`} accessibilityState={{ checked: !!trailingIcon, disabled: !!disabled }} accessibilityHint={subtitle} accessibilityLabel={tone} onPress={onPress}>
        {title}
      </Text>
    );
  },
}));

const row = (tree: TestRenderer.ReactTestRenderer, title: string) => tree.root.findByProps({ testID: `row:${title}` });
const ticked = (tree: TestRenderer.ReactTestRenderer, title: string) => row(tree, title).props.accessibilityState.checked;
const titles = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.type === "string" && String(node.props.testID ?? "").startsWith("row:")).map((node) => node.props.testID.slice(4));

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

  it("states first that the server allows transcoding, and leaves the levels to choose", () => {
    mockPermissions = { server: "http://a:8096", video: true, audio: true };
    const tree = mount();
    expect(titles(tree)).toEqual(["Transcoding on", ...LEVELS]);
    expect(row(tree, "Transcoding on").props.accessibilityHint).toBe("Set by your server for this account");
    expect(row(tree, "Only for unsupported files").props.accessibilityState.disabled).toBe(false);
  });

  it("states first, in red, that the server turned transcoding off, and disables the levels it overrules", () => {
    mockPermissions = { server: "http://a:8096", video: false, audio: true };
    const tree = mount();
    expect(titles(tree)).toEqual(["Transcoding off", ...LEVELS]);
    expect(row(tree, "Transcoding off").props.accessibilityLabel).toBe("destructive");
    for (const level of LEVELS) expect(row(tree, level).props.accessibilityState.disabled).toBe(true);
  });

  it("states a refusal of audio alone, and leaves the video levels to choose", () => {
    mockPermissions = { server: "http://a:8096", video: true, audio: false };
    const tree = mount();
    expect(titles(tree)[0]).toBe("Audio transcoding off");
    expect(row(tree, "When needed").props.accessibilityState.disabled).toBe(false);
  });
});
