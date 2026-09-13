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
    expect(currentPlaybackStage()).toEqual({ stage: null, since: 0, passed: [] });
  });
});
