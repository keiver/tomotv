import { LIVE_POOR_START_WINDOW_MS, LIVE_START_STEPS, liveStartBufferSeconds, noteLiveCleanStart, noteLiveStall, resetLiveStartBuffersForTests } from "../src/startBuffer";

describe("live start buffer per channel", () => {
  beforeEach(() => resetLiveStartBuffersForTests());

  it("starts every channel on 2 seconds", () => {
    expect(LIVE_START_STEPS).toEqual([2, 6, 15]);
    expect(liveStartBufferSeconds("ch-1")).toBe(2);
  });

  it("steps a channel up on each early stall and returns the seconds to hold for", () => {
    expect(noteLiveStall("ch-1", 5_000)).toBe(4);
    expect(liveStartBufferSeconds("ch-1")).toBe(6);
    expect(noteLiveStall("ch-1", 5_000)).toBe(9);
    expect(liveStartBufferSeconds("ch-1")).toBe(15);
    expect(liveStartBufferSeconds("ch-2")).toBe(2);
  });

  it("holds nothing more at the top step", () => {
    noteLiveStall("ch-1", 0);
    noteLiveStall("ch-1", 0);
    expect(noteLiveStall("ch-1", 0)).toBeNull();
    expect(liveStartBufferSeconds("ch-1")).toBe(15);
  });

  it("does not count a stall after the first minute as a poor start", () => {
    expect(noteLiveStall("ch-1", LIVE_POOR_START_WINDOW_MS + 1)).toBeNull();
    expect(liveStartBufferSeconds("ch-1")).toBe(2);
  });

  it("steps a channel back down one on a clean start", () => {
    noteLiveStall("ch-1", 0);
    noteLiveStall("ch-1", 0);
    noteLiveCleanStart("ch-1");
    expect(liveStartBufferSeconds("ch-1")).toBe(6);
    noteLiveCleanStart("ch-1");
    expect(liveStartBufferSeconds("ch-1")).toBe(2);
    noteLiveCleanStart("ch-1");
    expect(liveStartBufferSeconds("ch-1")).toBe(2);
  });
});
