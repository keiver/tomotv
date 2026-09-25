/** The guide disk cache: fresh copies skip the network, downloads replace atomically, failures serve stale. */
jest.mock("expo-file-system", () => require("./fakeFileSystem"));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

import { cachedGuideFile, clearGuideFileCache } from "../guideFileCache";
import { fakeFs, File } from "./fakeFileSystem";

const URL = "http://g/guide.xml.gz";
const HOUR = 60 * 60 * 1000;

describe("cachedGuideFile", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    fakeFs.clear();
    clearGuideFileCache();
    (File.downloadFileAsync as jest.Mock).mockClear().mockImplementation(async (_url: string, destination: File) => {
      destination.write("guide-bytes");
      return destination;
    });
  });
  afterEach(() => jest.useRealTimers());

  it("downloads once, then serves the file without the network while it is fresh", async () => {
    const uri = await cachedGuideFile(URL);
    expect(uri.startsWith("file:///cache/guides/guide-")).toBe(true);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + HOUR / 2);
    await expect(cachedGuideFile(URL)).resolves.toBe(uri);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
    // Past the freshness window it re-downloads to the same path.
    jest.setSystemTime(Date.now() + HOUR);
    await expect(cachedGuideFile(URL)).resolves.toBe(uri);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(2);
  });

  it("serves the stale copy when a re-download fails, and skips the network during the backoff", async () => {
    const uri = await cachedGuideFile(URL);
    jest.setSystemTime(Date.now() + 2 * HOUR);
    (File.downloadFileAsync as jest.Mock).mockRejectedValue(new Error("offline"));
    await expect(cachedGuideFile(URL)).resolves.toBe(uri);
    await expect(cachedGuideFile(URL)).resolves.toBe(uri);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(2);
  });

  it("throws on a failed first download and keeps skipping while the failure is recent", async () => {
    (File.downloadFileAsync as jest.Mock).mockRejectedValue(new Error("offline"));
    await expect(cachedGuideFile(URL)).rejects.toThrow("offline");
    await expect(cachedGuideFile(URL)).rejects.toThrow("skipped after a recent failure");
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(1);
    jest.setSystemTime(Date.now() + 6 * 60 * 1000);
    (File.downloadFileAsync as jest.Mock).mockImplementation(async (_url: string, destination: File) => {
      destination.write("guide-bytes");
      return destination;
    });
    await expect(cachedGuideFile(URL)).resolves.toContain("guides/guide-");
  });

  it("force re-downloads inside the freshness window and past a recent failure", async () => {
    const uri = await cachedGuideFile(URL);
    await cachedGuideFile(URL, undefined, { force: true });
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(2);
    // A forced attempt ignores the failure backoff but still serves the stale copy on failure.
    (File.downloadFileAsync as jest.Mock).mockRejectedValue(new Error("offline"));
    await expect(cachedGuideFile(URL, undefined, { force: true })).resolves.toBe(uri);
    await expect(cachedGuideFile(URL, undefined, { force: true })).resolves.toBe(uri);
    expect(File.downloadFileAsync).toHaveBeenCalledTimes(4);
  });

  it("keeps separate files per URL and sweeps copies older than two days", async () => {
    const first = await cachedGuideFile(URL);
    jest.setSystemTime(Date.now() + 49 * HOUR);
    const second = await cachedGuideFile("http://g/other.xml");
    expect(second).not.toBe(first);
    // The two-day-old copy is gone; the fresh one stays.
    expect([...fakeFs.keys()].filter((key) => key.includes("guide-"))).toEqual([second.replace("file://", "file://")]);
  });
});
