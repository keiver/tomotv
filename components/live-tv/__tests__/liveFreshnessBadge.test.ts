import { freshnessTimings, LIVE_FRESH_MS } from "@/components/live-tv/live-freshness-badge";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));

describe("freshnessTimings", () => {
  const at = 1_000_000;
  const dueAt = at + 120_000;

  it("holds LIVE for the fresh window of a just-landed burst, nothing elapsed", () => {
    expect(freshnessTimings(at, at, at, dueAt)).toEqual({ liveRemainMs: LIVE_FRESH_MS, dueRemainMs: 120_000, startFraction: 0 });
  });

  it("drops LIVE once the picture sits past the window, the pie drained to the elapsed share", () => {
    const now = at + 60_000;
    expect(freshnessTimings(now, at, at, dueAt)).toEqual({ liveRemainMs: 0, dueRemainMs: 60_000, startFraction: 0.5 });
  });

  it("keeps LIVE while frames land mid-burst: the window follows the picture, not the grab", () => {
    const now = at + 30_000;
    const { liveRemainMs } = freshnessTimings(now, now - 2_000, at, dueAt);
    expect(liveRemainMs).toBe(LIVE_FRESH_MS - 2_000);
  });

  it("floors an overdue picture at an empty pie and no time left", () => {
    expect(freshnessTimings(dueAt + 5_000, at, at, dueAt)).toEqual({ liveRemainMs: 0, dueRemainMs: 0, startFraction: 1 });
  });

  it("treats a due at or before the capture as already elapsed", () => {
    expect(freshnessTimings(at + 1, at, at, at).startFraction).toBe(1);
  });
});
