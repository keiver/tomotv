/** shareLog: the text lands in a cache file and that file, not the text, goes to the sheet. */
jest.mock("expo-file-system", () => require("./fakeFileSystem"));

const mockShare = jest.fn(async (_options: unknown) => ({ action: "sharedAction" }));
jest.mock("react-native", () => ({ Platform: { OS: "ios", isTV: false }, Share: { share: (options: unknown) => mockShare(options) } }));

import { shareLog } from "@/services/diagnosticsShare";
import { fakeFs } from "./fakeFileSystem";

describe("shareLog", () => {
  beforeEach(() => {
    fakeFs.clear();
    jest.clearAllMocks();
  });

  it("writes the log as a file in the cache and shares its URL", async () => {
    await shareLog("Tomo TV 2.2.2 (3)\niOS 26.5", "Tomo TV diagnostics, iPhone.txt");
    const uri = "file:///cache/diagnostics/Tomo TV diagnostics, iPhone.txt";
    expect(fakeFs.get(uri)?.content).toBe("Tomo TV 2.2.2 (3)\niOS 26.5");
    expect(mockShare).toHaveBeenCalledWith({ url: uri, title: "Tomo TV diagnostics, iPhone.txt" });
  });

  it("overwrites the previous file on the next share", async () => {
    await shareLog("first", "log.txt");
    await shareLog("second", "log.txt");
    expect(fakeFs.get("file:///cache/diagnostics/log.txt")?.content).toBe("second");
    expect(mockShare).toHaveBeenCalledTimes(2);
  });
});
