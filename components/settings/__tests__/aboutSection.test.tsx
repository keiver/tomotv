import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { AboutSection } from "@/components/settings/AboutSection";
import { ListRow } from "@/components/settings/ListRow";
import { ABOUT_LABEL } from "@/constants/app";
import { t } from "@/services/i18n";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush }), useFocusEffect: () => {} }));
jest.mock("@/components/settings/ListRow", () => ({ ListRow: () => null }));
jest.mock("@/components/settings/SwipeToRemove", () => ({ SwipeToRemove: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("react-native-gesture-handler", () => ({ GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/hooks/useLastSession", () => ({ useLastSession: () => null }));
jest.mock("@/hooks/useSentSessions", () => ({ useSentSessions: () => [] }));

function rows(showDiagnostics: boolean) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<AboutSection showDiagnostics={showDiagnostics} />);
  });
  const found = tree.root.findAllByType(ListRow);
  const summary = found.map((row) => ({ title: row.props.title, isFirst: !!row.props.isFirst, isLast: !!row.props.isLast }));
  return { summary, found, unmount: () => act(() => tree.unmount()) };
}

describe("AboutSection", () => {
  beforeEach(() => mockPush.mockClear());

  it("lists Media Licenses under About on any server, after Open Source and last when nothing played", () => {
    const { summary, unmount } = rows(true);
    expect(summary).toEqual([
      { title: ABOUT_LABEL, isFirst: true, isLast: false },
      { title: t("settings.mediaLicenses"), isFirst: false, isLast: true },
    ]);
    unmount();
  });

  it("keeps the Media Licenses row when diagnostics are hidden", () => {
    const { summary, unmount } = rows(false);
    expect(summary.map((row) => row.title)).toEqual([ABOUT_LABEL, t("settings.mediaLicenses")]);
    unmount();
  });

  it("opens the demo credits screen from the Media Licenses row", () => {
    const { found, unmount } = rows(true);
    act(() => found[1].props.onPress());
    expect(mockPush).toHaveBeenCalledWith("/demo-credits");
    unmount();
  });
});
