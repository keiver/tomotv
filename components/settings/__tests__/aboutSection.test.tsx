import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { AboutSection } from "@/components/settings/AboutSection";
import { ListRow } from "@/components/settings/ListRow";
import { t } from "@/services/i18n";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));

function rows() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<AboutSection />);
  });
  const found = tree.root.findAllByType(ListRow);
  const summary = found.map((row) => ({ title: row.props.title, isFirst: !!row.props.isFirst, isLast: !!row.props.isLast }));
  return { summary, found, unmount: () => act(() => tree.unmount()) };
}

describe("AboutSection", () => {
  beforeEach(() => mockPush.mockClear());

  it("lists the Demo credits row under About on any server, after Licenses and last", () => {
    const { summary, unmount } = rows();
    expect(summary).toEqual([
      { title: t("common.openSource"), isFirst: true, isLast: false },
      { title: t("settings.mediaLicenses"), isFirst: false, isLast: true },
    ]);
    unmount();
  });

  it("gives neither row a subtitle", () => {
    const { found, unmount } = rows();
    expect(found.map((row) => row.props.subtitle)).toEqual([undefined, undefined]);
    unmount();
  });

  it("opens the demo credits screen from the Demo credits row", () => {
    const { found, unmount } = rows();
    act(() => found[1].props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/demo-credits");
    unmount();
  });
});
