/** Acknowledgements: a credit with notices of its own shows them once its row is expanded. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Text } from "react-native";
import { spatialAudioNotices } from "@keiver/tomo-engine";
import LicensesScreen from "@/app/licenses";
import { LICENSE_TEXTS } from "@/constants/licenses";

jest.mock("@keiver/tomo-engine", () => ({ spatialAudioNotices: jest.fn(async () => "SpatialAudioBridge notices") }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/AccountPill", () => ({ AccountPill: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/settings/ListRow", () => ({
  ListRow: ({ title, onPress }: { title: string; onPress: () => void }) => {
    const { Text } = require("react-native");
    return <Text testID={`row:${title}`} onPress={onPress} />;
  },
}));

const shows = (tree: TestRenderer.ReactTestRenderer, text: string) => tree.root.findAllByType(Text).some((node) => node.props.children === text);

async function press(tree: TestRenderer.ReactTestRenderer, title: string) {
  await act(async () => {
    tree.root.findByProps({ testID: `row:${title}` }).props.onPress();
  });
}

describe("Licenses", () => {
  let tree: TestRenderer.ReactTestRenderer;

  beforeEach(async () => {
    jest.clearAllMocks();
    await act(async () => {
      tree = TestRenderer.create(<LicensesScreen />);
    });
  });

  afterEach(() => act(() => tree.unmount()));

  it("shows the package's own notices for SpatialAudioBridge and loads them once", async () => {
    await press(tree, "SpatialAudioBridge");
    expect(shows(tree, "SpatialAudioBridge notices")).toBe(true);

    await press(tree, "SpatialAudioBridge");
    expect(shows(tree, "SpatialAudioBridge notices")).toBe(false);
    await press(tree, "SpatialAudioBridge");
    expect(shows(tree, "SpatialAudioBridge notices")).toBe(true);
    expect(spatialAudioNotices).toHaveBeenCalledTimes(1);
  });

  it("keeps the shared license text for a credit without notices of its own", async () => {
    await press(tree, "dav1d");
    expect(shows(tree, LICENSE_TEXTS["BSD-2-Clause"])).toBe(true);
  });
});
