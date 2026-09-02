/**
 * Tests for sharePhoto: the name the recipient sees, the Download-then-image fallback, and the
 * local copy handed to the share sheet.
 */
jest.mock("expo-file-system", () => require("./fakeFileSystem"));

const mockShare = jest.fn(async (_options: unknown) => ({ action: "sharedAction" }));
jest.mock("react-native", () => ({ Platform: { OS: "ios", isTV: false }, Share: { share: (options: unknown) => mockShare(options) } }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfinApi", () => ({
  getPhotoFileUrl: jest.fn((id: string) => `http://jf/Items/${id}/Download`),
  getPhotoUrl: jest.fn((id: string) => `http://jf/Items/${id}/Images/Primary`),
}));

import { sharePhoto } from "@/services/sharePhoto";
import { JellyfinItem } from "@/types/jellyfin";
import { fakeFs, File } from "./fakeFileSystem";

const item = (overrides: Partial<JellyfinItem>): JellyfinItem => ({ Id: "p1", Name: "Beach", Type: "Photo", ...overrides }) as JellyfinItem;
const mockDownload = File.downloadFileAsync as jest.Mock;
const destinationOf = (call: number) => (mockDownload.mock.calls[call][1] as File).uri;

describe("sharePhoto", () => {
  beforeEach(() => {
    fakeFs.clear();
    jest.clearAllMocks();
    mockDownload.mockImplementation(async (_url: string, destination: File) => {
      destination.write("bytes");
      return destination;
    });
  });

  it("names the file by the server path's basename, on either separator", async () => {
    await sharePhoto(item({ Path: "C:\\Photos\\2024\\beach day.jpg" }));
    expect(destinationOf(0)).toBe("file:///cache/shared-photos/beach day.jpg");

    await sharePhoto(item({ Path: "/photos/2024/sunset.HEIC" }));
    expect(destinationOf(1)).toBe("file:///cache/shared-photos/sunset.HEIC");
  });

  it("falls back to the item name with separators stripped when the server reports no path", async () => {
    await sharePhoto(item({ Path: undefined, Name: "Trip: Rome/Day 1", Container: "PNG" }));
    expect(destinationOf(0)).toBe("file:///cache/shared-photos/Trip- Rome-Day 1.png");
  });

  it("falls back to the image endpoint when the Download endpoint fails", async () => {
    mockDownload.mockRejectedValueOnce(new Error("403"));

    await sharePhoto(item({ Path: "/p/a.jpg" }));

    expect(mockDownload.mock.calls.map((call) => call[0])).toEqual(["http://jf/Items/p1/Download", "http://jf/Items/p1/Images/Primary"]);
    expect(mockShare).toHaveBeenCalledWith({ url: "file:///cache/shared-photos/a.jpg", title: "Beach" });
  });

  it("treats an empty download as a failure and tries the next endpoint", async () => {
    mockDownload.mockImplementationOnce(async (_url: string, destination: File) => destination);

    await sharePhoto(item({ Path: "/p/a.jpg" }));

    expect(mockDownload).toHaveBeenCalledTimes(2);
    expect(mockShare).toHaveBeenCalledTimes(1);
  });

  it("throws, and shares nothing, when both endpoints fail", async () => {
    mockDownload.mockRejectedValue(new Error("offline"));

    await expect(sharePhoto(item({ Path: "/p/a.jpg" }))).rejects.toThrow("Could not download this photo to share.");
    expect(mockShare).not.toHaveBeenCalled();
  });

  it("hands the share sheet the local copy, never the server URL", async () => {
    await sharePhoto(item({ Path: "/p/a.jpg" }));

    expect(mockShare).toHaveBeenCalledWith({ url: "file:///cache/shared-photos/a.jpg", title: "Beach" });
  });
});
