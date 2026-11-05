/** The recording schedule the Recordings screen draws: running first, then upcoming by start, then the series rules, and the account's right to manage them. */
import { useRecordingSchedule } from "@/hooks/useRecordingSchedule";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const NOW = Date.parse("2026-11-05T20:30:00Z");
const timer = (Id: string, start: string, end: string, Status = "New") => ({ Id, Name: Id, ChannelId: "c1", StartDate: start, EndDate: end, Status });
const mockTimers = [
  timer("later", "2026-11-05T23:00:00Z", "2026-11-05T23:30:00Z"),
  timer("now", "2026-11-05T20:00:00Z", "2026-11-05T21:00:00Z", "InProgress"),
  timer("soon", "2026-11-05T21:00:00Z", "2026-11-05T21:30:00Z"),
];
let mockCanManage = true;
jest.mock("@/services/jellyfinApi", () => ({
  fetchTimers: jest.fn(async () => mockTimers),
  fetchSeriesTimers: jest.fn(async () => [{ Id: "rule", Name: "Rule" }]),
  fetchLiveTvManagement: jest.fn(async () => mockCanManage),
}));
jest.mock("@/services/recordingStatus", () => ({
  ...jest.requireActual("@/services/recordingStatus"),
  reportRecordingTimers: jest.fn(),
}));
jest.mock("@/services/toast", () => ({ showToast: jest.fn() }));
jest.mock("expo-router", () => ({ useIsFocused: () => true, useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

const renders: ReturnType<typeof useRecordingSchedule>[] = [];
const latest = () => renders[renders.length - 1];
function Probe() {
  renders.push(useRecordingSchedule(0));
  return null;
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
  mockCanManage = true;
});
afterEach(() => jest.useRealTimers());

async function mount() {
  let tree!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    tree = TestRenderer.create(<Probe />);
  });
  return tree;
}

it("lists what records now, then what is set to record by start, then the series rules", async () => {
  const tree = await mount();
  expect(latest().entries.map((entry) => entry.key)).toEqual(["running", "now", "upcoming", "soon", "later", "series", "series-rule"]);
  expect(latest().running.map((running) => running.Id)).toEqual(["now"]);
  expect(latest().canManage).toBe(true);
  tree.unmount();
});

it("reports an account that may not manage recordings", async () => {
  mockCanManage = false;
  const tree = await mount();
  expect(latest().canManage).toBe(false);
  tree.unmount();
});
