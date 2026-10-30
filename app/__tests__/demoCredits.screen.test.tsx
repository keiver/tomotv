import React from "react";
import { Linking } from "react-native";
import TestRenderer, { act } from "react-test-renderer";
import DemoCreditsScreen, { groupSubtitle, itemSubtitle } from "@/app/demo-credits";
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
  credit("Space", "Earthrise", { year: null }),
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

describe("the Media Licenses screen", () => {
  const openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(true);
  beforeEach(() => openURL.mockClear());

  it("lists each library's items under one row per maker and licence, in order", () => {
    const tree = render();
    const rows = tree.root.findAllByType(ListRow).map((row) => ({ title: row.props.title, nested: !!row.props.nested, first: !!row.props.isFirst, last: !!row.props.isLast }));
    expect(rows).toEqual([
      { title: "NASA", nested: false, first: true, last: false },
      { title: "Aurora", nested: true, first: false, last: false },
      { title: "Earthrise", nested: true, first: false, last: true },
      { title: "ESA", nested: false, first: true, last: false },
      { title: "Carina", nested: true, first: false, last: true },
      { title: "Blender Foundation", nested: false, first: true, last: false },
      { title: "Sintel", nested: true, first: false, last: true },
    ]);
    expect(
      tree.root
        .findAllByType(ListRow)
        .filter((row) => row.props.hasTVPreferredFocus)
        .map((row) => row.props.title),
    ).toEqual(["NASA"]);
    act(() => tree.unmount());
  });

  it("opens the licence page from a maker row and the source page from an item row", () => {
    const tree = render();
    const rows = tree.root.findAllByType(ListRow);
    act(() => rows[0].props.onPress());
    expect(openURL).toHaveBeenLastCalledWith("https://nasa.example/licence");
    act(() => rows[4].props.onPress());
    expect(openURL).toHaveBeenLastCalledWith("https://example.org/Carina");
    act(() => tree.unmount());
  });

  it("leads an item with its picture, and with a film glyph when the server has none", () => {
    const tree = render();
    const rows = tree.root.findAllByType(ListRow);
    const aurora = rows[1].props.icon;
    expect(typeof aurora).toBe("function");
    let mark!: TestRenderer.ReactTestRenderer;
    act(() => {
      mark = TestRenderer.create(aurora({ color: "#fff" }));
    });
    expect(mark.root.findByType(PosterMark).props.uri).toBe("https://example.org/Aurora.jpg");
    expect(rows[6].props.icon).toBe("film-outline");
    act(() => mark.unmount());
    act(() => tree.unmount());
  });

  it("writes the licence under a maker, with its page on TV, and the year or source under an item", () => {
    const [nasa, esa] = [mockItems[0], mockItems[1]];
    const group = { by: nasa.by, licence: nasa.licence, licenceUrl: nasa.licenceUrl, items: [nasa] };
    expect(groupSubtitle(group, false)).toBe("Public domain");
    expect(groupSubtitle(group, true)).toBe("Public domain · https://nasa.example/licence");
    expect(itemSubtitle(esa, false)).toBe("2016");
    expect(itemSubtitle(mockItems[2], false)).toBeUndefined();
    expect(itemSubtitle(esa, true)).toBe("https://example.org/Carina");
  });
});
