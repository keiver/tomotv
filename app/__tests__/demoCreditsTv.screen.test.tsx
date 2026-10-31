/** The Demo credits screen on Apple TV: nothing opens, the licence name sits at the row's edge as plain text. */
import React from "react";
import { Platform, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import { ListRow } from "@/components/settings/ListRow";
import type { DemoCredit } from "@/services/demoCredits";

const credit = (library: string, title: string, more: Partial<DemoCredit> = {}): DemoCredit => ({
  library,
  title,
  by: "NASA",
  year: 2016,
  licence: "Public domain",
  licenceUrl: "https://nasa.example/licence",
  source: `https://example.org/${title}`,
  image: `https://example.org/${title}.jpg`,
  ...more,
});
const mockItems = [
  credit("Space", "Aurora"),
  credit("Space", "Carina", { by: "ESA", licence: "CC BY 4.0", licenceUrl: "https://creativecommons.org/licenses/by/4.0/" }),
  credit("Live TV", "Sintel", { by: "Blender Foundation", licence: "CC BY 3.0; Blender Foundation", licenceUrl: "https://creativecommons.org/licenses/by/3.0/", image: null }),
];

jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));
jest.mock("@/components/settings/PosterMark", () => ({ PosterMark: () => null }));
jest.mock("@/services/demoCredits", () => {
  const actual = jest.requireActual("@/services/demoCredits");
  const mocked = { ...actual, fetchDemoCredits: jest.fn(async () => null) };
  Object.defineProperty(mocked, "BUNDLED_DEMO_CREDITS", { get: () => ({ generated: "2026-10-24T00:00:00Z", items: mockItems }) });
  return mocked;
});

Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
// Read after the flag: the screen fixes its platform at import.
const DemoCreditsScreen = (require("@/app/demo-credits") as typeof import("@/app/demo-credits")).default;

describe("the Demo credits screen on TV", () => {
  it("puts the licence's short name at every item row's edge as plain text, with no trailing button and no press", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<DemoCreditsScreen />);
    });
    const items = tree.root.findAllByType(ListRow).filter((row) => row.props.icon !== "ribbon-outline");
    expect(items.map((row) => ({ title: row.props.title, subtitle: row.props.subtitle, edge: row.props.trailingText, action: row.props.trailingAction, press: row.props.onPress }))).toEqual([
      { title: "Aurora", subtitle: "NASA", edge: "Public domain", action: undefined, press: undefined },
      { title: "Carina", subtitle: "ESA", edge: "CC BY 4.0", action: undefined, press: undefined },
      { title: "Sintel", subtitle: "Blender Foundation", edge: "CC BY 3.0", action: undefined, press: undefined },
    ]);
    act(() => tree.unmount());
  });

  it("lists each licence once in a last subgroup, with its page below, no edge text, and the footer closing the card", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<DemoCreditsScreen />);
    });
    const licences = tree.root.findAllByType(ListRow).filter((row) => row.props.icon === "ribbon-outline");
    expect(licences.map((row) => ({ title: row.props.title, subtitle: row.props.subtitle, edge: row.props.trailingText, last: !!row.props.isLast }))).toEqual([
      { title: "Public domain", subtitle: "https://nasa.example/licence", edge: undefined, last: false },
      { title: "CC BY 4.0", subtitle: "https://creativecommons.org/licenses/by/4.0/", edge: undefined, last: false },
      { title: "CC BY 3.0; Blender Foundation", subtitle: "https://creativecommons.org/licenses/by/3.0/", edge: undefined, last: false },
    ]);
    const texts = tree.root.findAllByType(Text).map((text) => text.props.children);
    expect(texts.join("")).toContain("2026");
    act(() => tree.unmount());
  });
});
