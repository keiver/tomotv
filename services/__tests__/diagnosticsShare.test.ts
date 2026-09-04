/** shareLog: the text lands in a cache file and that file, not the text, goes to the sheet. mailLog: a draft with the log as the body. */
jest.mock("expo-file-system", () => require("./fakeFileSystem"));

const mockShare = jest.fn(async (_options: unknown) => ({ action: "sharedAction" }));
const mockOpen = jest.fn(async (_url: string) => true);
jest.mock("react-native", () => ({ Platform: { OS: "ios", isTV: false }, Share: { share: (options: unknown) => mockShare(options) }, Linking: { openURL: (url: string) => mockOpen(url) } }));

import { mailLog, mailtoUrl, shareLog } from "@/services/diagnosticsShare";
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

describe("mailLog", () => {
  beforeEach(() => jest.clearAllMocks());

  it("opens a draft with the subject and the whole log in the body, every byte encoded", async () => {
    await mailLog('Tomo TV 2.2.2 (3)\n{\n  "mode": "localRemux"\n}', "Tomo TV diagnostics, Apple TV");
    const url = mockOpen.mock.calls[0][0];
    expect(url.startsWith("mailto:?subject=Tomo%20TV%20diagnostics%2C%20Apple%20TV&body=")).toBe(true);
    expect(decodeURIComponent(url.split("&body=")[1])).toBe('Tomo TV 2.2.2 (3)\n{\n  "mode": "localRemux"\n}');
    expect(url).not.toMatch(/[\s"{}]/);
  });

  it("lets a refused open reach the caller", async () => {
    mockOpen.mockRejectedValueOnce(new Error("no handler"));
    await expect(mailLog("x", "y")).rejects.toThrow("no handler");
    expect(mailtoUrl("a b", "c&d")).toBe("mailto:?subject=a%20b&body=c%26d");
  });
});
