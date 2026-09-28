import { currentPlaybackStage, resetPlaybackStages, setPlaybackStage, subscribePlaybackStage } from "../playbackStage";

describe("playback stage store", () => {
  beforeEach(() => resetPlaybackStages());

  it("keeps the stages passed, in order, and drops repeats of the current one", () => {
    setPlaybackStage("details");
    setPlaybackStage("details");
    setPlaybackStage("engine");
    setPlaybackStage("reading");
    expect(currentPlaybackStage()).toMatchObject({ stage: "reading", passed: ["details", "engine"] });
    expect(currentPlaybackStage().since).toBeGreaterThan(0);
  });

  it("tells listeners about every change and nothing else", () => {
    const seen: (string | null)[] = [];
    const stop = subscribePlaybackStage((state) => seen.push(state.stage));
    setPlaybackStage("details");
    setPlaybackStage("details");
    resetPlaybackStages();
    resetPlaybackStages();
    stop();
    setPlaybackStage("player");
    expect(seen).toEqual(["details", null]);
  });

  it("holds the failing stage until the next attempt resets it", () => {
    setPlaybackStage("opening");
    expect(currentPlaybackStage().stage).toBe("opening");
    resetPlaybackStages();
    expect(currentPlaybackStage()).toEqual({ stage: null, since: 0, startedAt: 0, passed: [] });
  });

  it("keeps the attempt's start across its stages and takes a new one after a reset", () => {
    jest.useFakeTimers();
    setPlaybackStage("details");
    const first = currentPlaybackStage().startedAt;
    jest.advanceTimersByTime(5000);
    setPlaybackStage("engine");
    expect(currentPlaybackStage()).toMatchObject({ startedAt: first, since: first + 5000 });
    resetPlaybackStages();
    jest.advanceTimersByTime(1000);
    setPlaybackStage("details");
    expect(currentPlaybackStage().startedAt).toBe(first + 6000);
    jest.useRealTimers();
  });
});
