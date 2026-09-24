/**
 * The Recordings screen's empty state: one card for an empty library and for an account the
 * server shares no recordings library with, since the server answers both the same way.
 */
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/library-grid", () => ({ LibraryGrid: () => null }));
jest.mock("@/components/tv-focus-holder", () => ({ TVFocusHolder: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => () => {} }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => () => {} }));
jest.mock("@/contexts/LibraryFiltersContext", () => ({
  useLibraryFilters: () => ({ getFilters: () => ({ genres: [], artistIds: [], years: [], favorite: false, played: false, unplayed: false, shuffle: false }) }),
}));
jest.mock("expo-router", () => ({
  Stack: { Screen: () => null },
  useIsFocused: () => true,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/services/jellyfinApi", () => ({
  fetchFilteredVideos: jest.fn(async () => []),
  fetchRecordingFolderIds: jest.fn(),
  fetchRecordings: jest.fn(async () => ({ items: [] })),
}));

import RecordingsScreen from "@/app/recordings";
import { t } from "@/services/i18n";
import { fetchRecordingFolderIds } from "@/services/jellyfinApi";

async function message(folderIds: Promise<string[]>): Promise<string> {
  (fetchRecordingFolderIds as jest.Mock).mockReturnValueOnce(folderIds);
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<RecordingsScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  const text = tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .join("|");
  tree.unmount();
  return text;
}

test("an empty list says so, and the footer says how an admin grants access", async () => {
  const text = await message(Promise.resolve([]));
  expect(text).toContain(t("liveTv.noRecordings"));
  expect(text).toContain(t("liveTv.noRecordingsHint"));
});
