/** playbackHold - which surface owns the link, asked per owner, with every change announced. */

import { isPlaybackHeld, isPlaybackHeldBesides, onPlaybackHoldChange, setPlaybackHold } from "../src/playbackHold";

afterEach(() => {
  setPlaybackHold("audio", false);
  setPlaybackHold("video", false);
  setPlaybackHold("multiview", false);
});

it("answers whether any owner other than the one named holds the link", () => {
  setPlaybackHold("multiview", true);
  expect(isPlaybackHeld()).toBe(true);
  expect(isPlaybackHeldBesides("multiview")).toBe(false);
  setPlaybackHold("video", true);
  expect(isPlaybackHeldBesides("multiview")).toBe(true);
});

it("answers per owner as well as for any", () => {
  setPlaybackHold("audio", true);
  expect(isPlaybackHeld()).toBe(true);
  expect(isPlaybackHeld("audio")).toBe(true);
  expect(isPlaybackHeld("video")).toBe(false);
});

it("announces video joining and leaving an audio hold", () => {
  setPlaybackHold("audio", true);
  const changed = jest.fn();
  const stop = onPlaybackHoldChange(changed);

  setPlaybackHold("video", true);
  expect(changed).toHaveBeenCalledTimes(1);
  setPlaybackHold("video", true);
  expect(changed).toHaveBeenCalledTimes(1);
  setPlaybackHold("video", false);
  expect(changed).toHaveBeenCalledTimes(2);

  stop();
  setPlaybackHold("video", true);
  expect(changed).toHaveBeenCalledTimes(2);
});
