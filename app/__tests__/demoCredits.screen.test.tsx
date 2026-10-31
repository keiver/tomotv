import React from "react";
import { Linking, Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import DemoCreditsScreen, { visibleCreditRows } from "@/app/demo-credits";
import { ListRow } from "@/components/settings/ListRow";
import { PosterMark } from "@/components/settings/PosterMark";
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
  credit("Live TV", "Sintel", { by: "Blender Foundation", licence: "CC BY 3.0", licenceUrl: "https://creativecommons.org/licenses/by/3.0/", image: null }),
];

jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));
jest.mock("@/components/settings/PosterMark", () => ({ PosterMark: () => null }));
jest.mock("@/services/demoCredits", () => {
  const actual = jest.requireActual("@/services/demoCredits");
  const mocked = { ...actual, fetchDemoCredits: jest.fn(async () => null) };
  // A getter, defined after the spread so it is read at render time: the mock is hoisted above the fixture.
  Object.defineProperty(mocked, "BUNDLED_DEMO_CREDITS", { get: () => ({ generated: "2026-10-24T00:00:00Z", items: mockItems }) });
  return mocked;
});

function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<DemoCreditsScreen />);
  });
  return tree;
}

describe("the Demo credits screen", () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  beforeEach(() => openURL.mockClear());

  it("lists one row per item under its library heading in one card: the maker below the title, the licence's short name at the edge, no trailing glyph, no licence rows off TV", () => {
    const tree = render();
    const headers = tree.root.findAllByType(Text).map((text) => text.props.children);
    expect(headers).toEqual(expect.arrayContaining(["Space", "Live TV"]));
    const rows = tree.root.findAllByType(ListRow).map((row) => ({
      title: row.props.title,
      subtitle: row.props.subtitle,
      edge: row.props.trailingAction.text,
      trailingIcon: row.props.trailingIcon,
      first: !!row.props.isFirst,
      last: !!row.props.isLast,
    }));
    expect(rows).toEqual([
      { title: "Aurora", subtitle: "NASA", edge: "Public domain", trailingIcon: undefined, first: false, last: false },
      { title: "Carina", subtitle: "ESA", edge: "CC BY 4.0", trailingIcon: undefined, first: false, last: false },
      { title: "Sintel", subtitle: "Blender Foundation", edge: "CC BY 3.0", trailingIcon: undefined, first: false, last: false },
    ]);
    const footers = tree.root.findAllByType(Text).map((text) => text.props.children);
    expect(footers.join("")).toContain("2026");
    expect(
      tree.root
        .findAllByType(ListRow)
        .filter((row) => row.props.hasTVPreferredFocus)
        .map((row) => row.props.title),
    ).toEqual(["Aurora"]);
    act(() => tree.unmount());
  });

  it("opens the source page from the row and the licence page from the licence name at its edge", () => {
    const tree = render();
    const rows = tree.root.findAllByType(ListRow);
    act(() => rows[1].props.onPress());
    expect(openURL).toHaveBeenLastCalledWith("https://example.org/Carina");
    expect(rows[1].props.trailingAction.label).toBe("License: CC BY 4.0");
    act(() => rows[1].props.trailingAction.onPress());
    expect(openURL).toHaveBeenLastCalledWith("https://creativecommons.org/licenses/by/4.0/");
    act(() => tree.unmount());
  });

  it("leads an item with its picture, and with a film glyph when the server has none", () => {
    const tree = render();
    const rows = tree.root.findAllByType(ListRow);
    const aurora = rows[0].props.icon;
    expect(typeof aurora).toBe("function");
    let mark!: TestRenderer.ReactTestRenderer;
    act(() => {
      mark = TestRenderer.create(aurora({ color: "#fff" }));
    });
    expect(mark.root.findByType(PosterMark).props.uri).toBe("https://example.org/Aurora.jpg");
    expect(rows[2].props.icon).toBe("film-outline");
    act(() => mark.unmount());
    act(() => tree.unmount());
  });

  it("fits whole rows to the measured height, the first subgroup header and the footer budgeted, never below one", () => {
    // Phone in jest: 66pt rows, 38pt subgroup header.
    expect(visibleCreditRows(700, 50, 60)).toBe(8);
    expect(visibleCreditRows(1400, 50, 60)).toBe(18);
    expect(visibleCreditRows(400, 50, 60)).toBe(3);
    expect(visibleCreditRows(120, 50, 60)).toBe(1);
  });

  it("off TV the rows carry no plain trailing text", () => {
    const tree = render();
    expect(tree.root.findAllByType(ListRow).map((row) => row.props.trailingText)).toEqual([undefined, undefined, undefined]);
    act(() => tree.unmount());
  });
});
