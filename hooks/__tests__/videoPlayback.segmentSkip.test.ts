import { openSkipTarget, segmentSkipTarget } from "../videoPlayback/segmentSkip";

const breaks = [
  { startSeconds: 600, endSeconds: 720 },
  { startSeconds: 1200, endSeconds: 1380 },
];

describe("segmentSkipTarget", () => {
  it("skips to a break's end when playback crosses its start", () => {
    expect(segmentSkipTarget(breaks, 599.6, 600.1)).toBe(720);
    expect(segmentSkipTarget(breaks, 1199.9, 1200.2)).toBe(1380);
  });

  it("leaves a landing inside a break alone: a seek or resume chose it", () => {
    expect(segmentSkipTarget(breaks, 100, 650)).toBeNull();
    expect(segmentSkipTarget(breaks, 590, 601)).toBeNull();
    expect(segmentSkipTarget(breaks, 650, 650.5)).toBeNull();
  });

  it("ignores backward moves, the last half second, and no windows", () => {
    expect(segmentSkipTarget(breaks, 800, 600.2)).toBeNull();
    expect(segmentSkipTarget([{ startSeconds: 600, endSeconds: 600.4 }], 599.9, 600.1)).toBeNull();
    expect(segmentSkipTarget(undefined, 599.6, 600.1)).toBeNull();
    expect(segmentSkipTarget([], 599.6, 600.1)).toBeNull();
  });
});

describe("openSkipTarget", () => {
  const intro = [{ startSeconds: 0, endSeconds: 90 }];

  it("returns the end of the window playback opens inside of", () => {
    expect(openSkipTarget(intro, 0)).toBe(90);
    expect(openSkipTarget(intro, 45)).toBe(90);
    expect(openSkipTarget(breaks, 650)).toBe(720);
  });

  it("returns null outside every window, in the last half second, and with no windows", () => {
    expect(openSkipTarget(intro, 90)).toBeNull();
    expect(openSkipTarget(intro, 89.6)).toBeNull();
    expect(openSkipTarget(breaks, 100)).toBeNull();
    expect(openSkipTarget(undefined, 0)).toBeNull();
    expect(openSkipTarget([], 0)).toBeNull();
  });
});
