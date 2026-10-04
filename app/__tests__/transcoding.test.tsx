/** The Server transcoding page: three levels, the chosen one ticked, a press applies at once, and the server's refusal heads the card. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import TranscodingScreen from "@/app/transcoding";
import { getUiPreferences, updateUiPreferences } from "@/services/uiPreferences";
import { refreshTranscodePermissions } from "@/services/jellyfin/transcodePermissions";

jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/settings/StreamingQuality", () => ({ StreamingQuality: () => null }));

let mockPermissions: { server: string; video: boolean; audio: boolean } | null = null;
jest.mock("@/services/jellyfin/transcodePermissions", () => ({
  refreshTranscodePermissions: jest.fn(async () => {}),
  getTranscodePermissions: () => mockPermissions,
  subscribeTranscodePermissions: () => () => {},
}));

jest.mock("@/components/settings/ListRow", () => ({
  ListRow: ({ title, onPress, trailingIcon }: { title: string; onPress: () => void; trailingIcon?: unknown }) => {
    const { Text } = require("react-native");
    return (
      <Text testID={`row:${title}`} accessibilityState={{ checked: !!trailingIcon }} onPress={onPress}>
        {title}
      </Text>
    );
  },
}));

const row = (tree: TestRenderer.ReactTestRenderer, title: string) => tree.root.findByProps({ testID: `row:${title}` });
const ticked = (tree: TestRenderer.ReactTestRenderer, title: string) => row(tree, title).props.accessibilityState.checked;
const titles = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.type === "string" && String(node.props.testID ?? "").startsWith("row:")).map((node) => node.props.testID.slice(4));
const notes = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .filter((child): child is string => typeof child === "string");

const mounted: TestRenderer.ReactTestRenderer[] = [];

function mount() {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(<TranscodingScreen />);
  });
  mounted.push(tree!);
  return tree!;
}

describe("Server transcoding page", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPermissions = null;
    updateUiPreferences({ serverTranscoding: "linkOrFile" });
  });

  afterEach(() => {
    act(() => mounted.splice(0).forEach((tree) => tree.unmount()));
  });

  it("lists the three levels with the device's choice ticked, and asks the server for its policy", () => {
    const tree = mount();
    expect(titles(tree)).toEqual(["When the connection or the file needs it", "Only for files this device can't play", "Never"]);
    expect(ticked(tree, "When the connection or the file needs it")).toBe(true);
    expect(ticked(tree, "Never")).toBe(false);
    expect(refreshTranscodePermissions).toHaveBeenCalledTimes(1);
  });

  it("applies a press at once and moves the tick", () => {
    const tree = mount();
    act(() => row(tree, "Never").props.onPress());
    expect(getUiPreferences().serverTranscoding).toBe("never");
    expect(ticked(tree, "Never")).toBe(true);
    expect(ticked(tree, "When the connection or the file needs it")).toBe(false);
  });

  it("shows no restriction notice while the server allows transcoding", () => {
    mockPermissions = { server: "http://a:8096", video: true, audio: true };
    const lines = notes(mount());
    expect(lines.some((line) => line.includes("does not allow"))).toBe(false);
  });

  it("heads the card with the server's refusal when the account may not transcode video", () => {
    mockPermissions = { server: "http://a:8096", video: false, audio: true };
    const lines = notes(mount());
    const notice = lines.findIndex((line) => line.startsWith("Your server does not allow video transcoding"));
    expect(notice).toBeGreaterThan(-1);
    expect(notice).toBeLessThan(lines.indexOf("When the connection or the file needs it"));
  });
});
