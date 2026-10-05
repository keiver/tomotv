/** openFailures - the memo that keeps a channel whose open failed out of the ring and the sampler. */

import { clearOpenFailure, noteOpenFailed, openRecentlyFailed } from "../src/openFailures";

const NOW = 1_700_000_000_000;
let now = NOW;
jest.spyOn(Date, "now").mockImplementation(() => now);

beforeEach(() => {
  now = NOW;
});

it("holds a failure for ten minutes, then forgets it", () => {
  noteOpenFailed("c1");
  expect(openRecentlyFailed("c1")).toBe(true);
  now = NOW + 10 * 60_000 - 1;
  expect(openRecentlyFailed("c1")).toBe(true);
  now = NOW + 10 * 60_000;
  expect(openRecentlyFailed("c1")).toBe(false);
  now = NOW;
  expect(openRecentlyFailed("c1")).toBe(false);
});

it("answers false for a channel that never failed", () => {
  expect(openRecentlyFailed("never")).toBe(false);
});

it("clears a failure on a successful open", () => {
  noteOpenFailed("c2");
  clearOpenFailure("c2");
  expect(openRecentlyFailed("c2")).toBe(false);
});
