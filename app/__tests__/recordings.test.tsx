/**
 * The Recordings screen: finished recordings with the schedule above them. The empty state is one card for an empty
 * library and for an account the server shares no recordings library with, since the server answers both the same way;
 * the schedule and its Stop All show only to an account that may manage recordings.
 */
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockGridProps: Record<string, unknown>[] = [];
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/library-grid", () => ({
  LibraryGrid: (props: Record<string, unknown>) => {
    mockGridProps.push(props);
    return null;
  },
}));
jest.mock("@/components/tv-focus-holder", () => ({ TVFocusHolder: () => null }));
jest.mock("@/components/FocusableButton", () => ({ FocusableButton: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/hooks/useItemLongPress", () => ({ useItemLongPress: () => () => {} }));
jest.mock("@/hooks/useOpenShelfItem", () => ({ useOpenShelfItem: () => () => {} }));
jest.mock("@/contexts/LibraryFiltersContext", () => ({
  useLibraryFilters: () => ({
    getFilters: () => ({ genres: [], artistIds: [], years: [], favorite: false, played: false, unplayed: false, shuffle: false, sortBy: "SortName", sortOrder: "Ascending" }),
  }),
}));
type HeaderItem = { label?: string; type: string };
let mockScreenOptions: { unstable_headerRightItems?: () => HeaderItem[] } = {};
jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockScreenOptions }) => {
      mockScreenOptions = options;
      return null;
    },
  },
  useIsFocused: () => true,
  useLocalSearchParams: () => ({}),
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
}));
jest.mock("@/services/jellyfinApi", () => ({
  fetchFilteredVideos: jest.fn(async () => []),
  fetchRecordingFolderIds: jest.fn(),
  fetchRecordings: jest.fn(async () => ({ items: [] })),
  subscribeRecordingsChange: jest.fn(() => jest.fn()),
}));
const timer = { Id: "t1", Name: "News", ChannelId: "c1", StartDate: "2026-11-05T20:00:00Z", EndDate: "2026-11-05T21:00:00Z" };
const mockSchedule = {
  entries: [] as { kind: string; key: string }[],
  running: [] as (typeof timer)[],
  nowMs: 0,
  canManage: true,
  isLoading: false,
  error: null as string | null,
  reload: jest.fn(),
  onTimerPress: jest.fn(),
  stopping: false,
  confirmStopAll: jest.fn(),
};
jest.mock("@/hooks/useRecordingSchedule", () => ({ useRecordingSchedule: () => mockSchedule }));
jest.mock("@/components/live-tv/recording-schedule", () => ({ RecordingSchedule: () => null }));

import RecordingsScreen from "@/app/recordings";
import { RecordingSchedule } from "@/components/live-tv/recording-schedule";
import { t } from "@/services/i18n";
import { fetchRecordingFolderIds, fetchRecordings } from "@/services/jellyfinApi";

async function mount(folderIds: string[] = []) {
  (fetchRecordingFolderIds as jest.Mock).mockReturnValueOnce(Promise.resolve(folderIds));
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<RecordingsScreen />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  return tree;
}
const texts = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root
    .findAllByType(Text)
    .map((node) => node.props.children)
    .join("|");
const barLabels = () => (mockScreenOptions.unstable_headerRightItems?.() ?? []).map((item) => item.label);
const lastGrid = () => mockGridProps.at(-1) as { leadContent?: React.ReactElement; emptyContent?: React.ReactNode; items: unknown[] } | undefined;

beforeEach(() => {
  mockGridProps.length = 0;
  mockScreenOptions = {};
  Object.assign(mockSchedule, { entries: [], running: [], canManage: true, error: null });
});

test("an empty list says so, and the footer says how an admin grants access", async () => {
  const tree = await mount();
  expect(texts(tree)).toContain(t("liveTv.noRecordings"));
  expect(texts(tree)).toContain(t("liveTv.noRecordingsHint"));
  tree.unmount();
});

test("with timers and nothing recorded, the schedule sits above the empty recordings card", async () => {
  mockSchedule.entries = [
    { kind: "heading", key: "upcoming" },
    { kind: "timer", key: "t1" },
  ];
  const tree = await mount();
  expect(lastGrid()?.leadContent?.type).toBe(RecordingSchedule);
  expect(lastGrid()?.emptyContent).toBeTruthy();
  tree.unmount();
});

test("with recordings, the schedule sits above their cards", async () => {
  (fetchRecordings as jest.Mock).mockResolvedValueOnce({ items: [{ Id: "r1", Name: "News", Type: "Recording" }] });
  mockSchedule.entries = [
    { kind: "heading", key: "upcoming" },
    { kind: "timer", key: "t1" },
  ];
  const tree = await mount();
  expect(lastGrid()?.items).toHaveLength(1);
  expect(lastGrid()?.leadContent?.type).toBe(RecordingSchedule);
  tree.unmount();
});

test("an account that may not manage recordings sees no schedule and no Stop All", async () => {
  (fetchRecordings as jest.Mock).mockResolvedValueOnce({ items: [{ Id: "r1", Name: "News", Type: "Recording" }] });
  Object.assign(mockSchedule, { canManage: false, entries: [{ kind: "timer", key: "t1" }], running: [timer] });
  const tree = await mount();
  expect(lastGrid()?.leadContent ?? null).toBeNull();
  expect(barLabels()).not.toContain(t("liveTv.stopAllRecordings"));
  tree.unmount();
});

test("Stop All rides the bar while something records, and leaves it once nothing does", async () => {
  (fetchRecordings as jest.Mock).mockResolvedValueOnce({ items: [{ Id: "r1", Name: "News", Type: "Recording" }] });
  Object.assign(mockSchedule, { entries: [{ kind: "timer", key: "t1" }], running: [timer] });
  const tree = await mount();
  expect(barLabels()).toContain(t("liveTv.stopAllRecordings"));
  tree.unmount();
  mockSchedule.running = [];
  const idle = await mount();
  expect(barLabels()).not.toContain(t("liveTv.stopAllRecordings"));
  idle.unmount();
});
