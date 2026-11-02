import { Settings } from "react-native";
import {
  ANONYMOUS_DAILY_DOWNLOADS,
  countDownload,
  DOWNLOAD_ALLOWANCE_KEY,
  downloadsLeft,
  nextUtcMidnight,
  recordDownloadsLeft,
  resetDownloadAccount,
  setDownloadAccount,
} from "@/services/subtitles/downloadAllowance";

const noon = Date.UTC(2026, 10, 1, 12);
const nextDay = Date.UTC(2026, 10, 2, 9);

const store: Record<string, unknown> = {};

beforeEach(() => {
  jest.spyOn(Settings, "get").mockImplementation((key: string) => store[key]);
  jest.spyOn(Settings, "set").mockImplementation((values: object) => void Object.assign(store, values));
  delete store[DOWNLOAD_ALLOWANCE_KEY];
  resetDownloadAccount();
});

afterEach(() => jest.restoreAllMocks());

describe("the downloads left today", () => {
  it("starts at the free allowance without a sign-in and counts every download down", () => {
    expect(downloadsLeft(noon)).toBe(ANONYMOUS_DAILY_DOWNLOADS);
    countDownload(noon);
    countDownload(noon);
    expect(downloadsLeft(noon)).toBe(3);
  });

  it("keeps the count across a launch", () => {
    countDownload(noon);
    resetDownloadAccount();
    expect(downloadsLeft(noon)).toBe(4);
  });

  it("takes the provider's figure over the count and never goes below zero", () => {
    recordDownloadsLeft(1, {}, noon);
    countDownload(noon);
    countDownload(noon);
    expect(downloadsLeft(noon)).toBe(0);
  });

  it("restores the daily allowance once the provider's day ends", () => {
    recordDownloadsLeft(0, { resetsAt: Date.UTC(2026, 10, 1, 18) }, noon);
    expect(downloadsLeft(Date.UTC(2026, 10, 1, 17))).toBe(0);
    expect(downloadsLeft(Date.UTC(2026, 10, 1, 19))).toBe(ANONYMOUS_DAILY_DOWNLOADS);
    recordDownloadsLeft(0, {}, noon);
    expect(downloadsLeft(nextDay)).toBe(ANONYMOUS_DAILY_DOWNLOADS);
  });

  it("knows nothing of a signed-in account until an answer counts it, then keeps its own allowance", () => {
    setDownloadAccount("viewer");
    expect(downloadsLeft(noon)).toBeNull();
    recordDownloadsLeft(19, { daily: 20 }, noon);
    countDownload(noon);
    expect(downloadsLeft(noon)).toBe(18);
    expect(downloadsLeft(nextDay)).toBe(20);
    setDownloadAccount("");
    expect(downloadsLeft(noon)).toBe(ANONYMOUS_DAILY_DOWNLOADS);
  });

  it("ends the day at the next midnight UTC", () => {
    expect(nextUtcMidnight(noon)).toBe(Date.UTC(2026, 10, 2));
  });
});
