import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ListRow } from "@/components/settings/ListRow";
import { PlaybackSection } from "@/components/settings/PlaybackSection";
import { t } from "@/services/i18n";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));

describe("PlaybackSection", () => {
  it("shows the skip and lyrics rows, each opening its own page", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<PlaybackSection />);
    });
    const rows = tree.root.findAllByType(ListRow);
    expect(rows.map((row) => ({ title: row.props.title, isFirst: !!row.props.isFirst, isLast: !!row.props.isLast }))).toEqual([
      { title: t("settings.skipAutomatically"), isFirst: true, isLast: false },
      { title: t("detail.lyrics"), isFirst: false, isLast: true },
    ]);
    rows[0].props.onPress();
    rows[1].props.onPress();
    expect(mockPush.mock.calls).toEqual([["/skip-settings"], ["/lyrics-settings"]]);
    act(() => tree.unmount());
  });
});
