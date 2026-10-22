/** liveRecovery - a dropped live channel opens again with a growing wait and is never handed elsewhere. */

import { LIVE_RECOVERY_RESET_MS, isPermanentLiveFailure, liveReopenCount, planLiveRecovery } from "../src/liveRecovery";

it("reopens a dropped channel after half a second, then waits longer each time up to five seconds", () => {
  expect([0, 1, 2, 3, 4, 5, 40].map((attempts) => planLiveRecovery({ attempts, permanent: false }))).toEqual([
    { reopen: true, delayMs: 500 },
    { reopen: true, delayMs: 1000 },
    { reopen: true, delayMs: 2000 },
    { reopen: true, delayMs: 4000 },
    { reopen: true, delayMs: 5000 },
    { reopen: true, delayMs: 5000 },
    { reopen: true, delayMs: 5000 },
  ]);
});

it("stops only on a failure no reopen fixes", () => {
  expect(planLiveRecovery({ attempts: 0, permanent: true })).toEqual({ reopen: false });
});

it("counts from zero again once the channel played a minute without a drop", () => {
  expect(liveReopenCount(4, LIVE_RECOVERY_RESET_MS - 1)).toBe(4);
  expect(liveReopenCount(4, LIVE_RECOVERY_RESET_MS)).toBe(0);
});

it("treats an origin that refuses the channel, DRM, and an input the engine gave up as permanent", () => {
  expect(isPermanentLiveFailure("live input gone: Server returned 404 Not Found")).toBe(true);
  expect(isPermanentLiveFailure("origin refused the playlist (HTTP 403)")).toBe(true);
  expect(isPermanentLiveFailure("channel is DRM protected (com.widevine)")).toBe(true);
  // The same failures behind an app's own prefix for a failed start.
  expect(isPermanentLiveFailure("engine failed: origin refused the playlist (HTTP 403)")).toBe(true);
  expect(isPermanentLiveFailure("engine failed: live input gone: Server returned 404 Not Found")).toBe(true);
});

it("treats a provider held by a recording as permanent", () => {
  expect(isPermanentLiveFailure("live origin is held by a recording")).toBe(true);
  expect(planLiveRecovery({ attempts: 0, permanent: isPermanentLiveFailure("engine failed: live origin is held by a recording") })).toEqual({ reopen: false });
});

it("treats a lost input, a silent feed and an unreachable host as worth another open", () => {
  expect(isPermanentLiveFailure("live input lost: no data for 12s")).toBe(false);
  expect(isPermanentLiveFailure("the live input came back with other streams")).toBe(false);
  expect(isPermanentLiveFailure("origin unreachable (cannot find host)")).toBe(false);
});
