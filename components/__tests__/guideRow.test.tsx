/** A guide row re-renders a cell only when that cell's own state moves, and wears reels only inside the span it is handed. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { Animated } from "react-native";

let mockCellRenders = 0;
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/jellyfinApi", () => ({ getPosterUrl: (id: string) => `poster:${id}`, getCachedConfig: () => ({ server: "http://jf" }) }));
// One object: useSyncExternalStore re-renders forever on a fresh snapshot each read.
const mockRowReel = { at: 1, frames: [{ uri: "file:///f0.jpg", cacheKey: "k0" }] };
jest.mock("@/services/liveFrames", () => ({ liveFrameReel: () => mockRowReel, subscribeLiveFrame: () => () => undefined }));
jest.mock("expo-image", () => ({ Image: (props: object) => require("react").createElement("Image", props) }));
// Called once per cell render.
jest.mock("@/hooks/useGuideChannelFocus", () => ({
  useGuideChannelFocus: () => {
    mockCellRenders += 1;
    return false;
  },
}));

import { GuideRow } from "@/components/live-tv/guide-row";
import type { JellyfinItem, JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { guideMetrics, MINUTE_MS, type CanvasSpan } from "@/utils/guide";

const CELLS = 8;
const SLOT = 60 * MINUTE_MS;
const T0 = Date.UTC(2026, 8, 12, 4, 0, 0);
const metrics = guideMetrics(true);
const slotPx = 60 * metrics.pxPerMinute;
const scrollX = new Animated.Value(0);
const channel = { Id: "c1", Name: "One", Type: "TvChannel" } as JellyfinItem;
const programs = Array.from({ length: CELLS }, (_, i): JellyfinProgram => ({
  Id: `p${i}`,
  ChannelId: "c1",
  Name: `Show ${i}`,
  StartDate: new Date(T0 + i * SLOT).toISOString(),
  EndDate: new Date(T0 + (i + 1) * SLOT).toISOString(),
}));
const noTimers = new Map<string, JellyfinTimer>();
const press = () => undefined;

interface RowInputs {
  nowMs: number;
  timers?: Map<string, JellyfinTimer>;
  artSpan?: CanvasSpan;
}
const row = ({ nowMs, timers = noTimers, artSpan }: RowInputs) => (
  <GuideRow
    channel={channel}
    programs={programs}
    windowStartMs={T0}
    windowEndMs={T0 + CELLS * SLOT}
    metrics={metrics}
    spanPx={CELLS * slotPx}
    nowMs={nowMs}
    timersByProgramId={timers}
    scrollX={scrollX}
    viewportWidth={1600}
    artSpan={artSpan}
    rowIndex={0}
    onProgramPress={press}
    onProgramLongPress={press}
  />
);

function mount(inputs: RowInputs) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(row(inputs));
  });
  mockCellRenders = 0;
  return tree;
}
const reelCount = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => node.props.testID === "guide-focus-reel" && typeof node.type === "string").length;

describe("GuideRow", () => {
  it("a minute inside the same programme re-renders no cell", () => {
    const tree = mount({ nowMs: T0 + 5 * MINUTE_MS });
    act(() => tree.update(row({ nowMs: T0 + 6 * MINUTE_MS })));
    expect(mockCellRenders).toBe(0);
  });

  it("a programme boundary re-renders the cell that ended and the one that began", () => {
    const tree = mount({ nowMs: T0 + 59 * MINUTE_MS });
    act(() => tree.update(row({ nowMs: T0 + 60 * MINUTE_MS })));
    expect(mockCellRenders).toBe(2);
  });

  it("a timers map rebuilt with the same marks re-renders no cell", () => {
    const tree = mount({ nowMs: T0 + 5 * MINUTE_MS });
    act(() => tree.update(row({ nowMs: T0 + 5 * MINUTE_MS, timers: new Map() })));
    expect(mockCellRenders).toBe(0);
  });

  it("wears reels only inside the span it is handed", () => {
    expect(reelCount(mount({ nowMs: T0 }))).toBe(0);
    // The span touches three cells, but only the airing one wears a reel.
    expect(reelCount(mount({ nowMs: T0, artSpan: { fromPx: 0, toPx: 2 * slotPx } }))).toBe(1);
  });
});
