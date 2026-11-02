import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ListRow } from "@/components/settings/ListRow";
import { UiSection } from "@/components/settings/UiSection";
import { t } from "@/services/i18n";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));

function rowTitles(signedIn: boolean) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<UiSection signedIn={signedIn} />);
  });
  const rows = tree.root.findAllByType(ListRow).map((row) => ({ title: row.props.title, isLast: !!row.props.isLast }));
  act(() => tree.unmount());
  return rows;
}

describe("UiSection", () => {
  it("shows only Language and Appearance when logged out, Appearance last", () => {
    expect(rowTitles(false)).toEqual([
      { title: t("settings.language"), isLast: false },
      { title: t("settings.appearance"), isLast: true },
    ]);
  });

  it("shows the poster row when signed in, posters last", () => {
    expect(rowTitles(true)).toEqual([
      { title: t("settings.language"), isLast: false },
      { title: t("settings.appearance"), isLast: false },
      { title: t("settings.devicePosters"), isLast: true },
    ]);
  });
});
