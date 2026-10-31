jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
const mockFetch = jest.fn();
jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: (...args: unknown[]) => mockFetch(...args) }));
jest.mock("@/services/jellyfin/constants", () => ({ API_TIMEOUTS: { QUICK: 10000, NORMAL: 15000, EXTENDED: 30000 } }));
jest.mock("@/services/jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "http://server:8096", apiKey: "k", userId: "u", deviceId: "d" })),
  getAuthHeader: () => "MediaBrowser Token=k",
}));
const mockInvalidate = jest.fn();
jest.mock("@/services/requestCache", () => ({ invalidateRequest: (...args: unknown[]) => mockInvalidate(...args) }));
const mockDetails = jest.fn();
jest.mock("@/services/jellyfin/items", () => ({ fetchVideoDetails: (...args: unknown[]) => mockDetails(...args) }));

import {
  canManageSubtitles,
  downloadRemoteSubtitle,
  externalTextStreams,
  fetchRemoteSubtitleFile,
  resetSubtitlePermission,
  searchRemoteSubtitles,
  toBase64Utf8,
  uploadSubtitle,
  waitForSubtitleStream,
} from "@/services/jellyfin/subtitleSearch";

function json(body: unknown, status = 200): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, text: async () => (typeof body === "string" ? body : JSON.stringify(body)) } as unknown as Response;
}

beforeEach(() => {
  mockFetch.mockReset();
  mockDetails.mockReset();
  mockInvalidate.mockReset();
  resetSubtitlePermission();
});

describe("canManageSubtitles", () => {
  it("reads the policy once per account", async () => {
    mockFetch.mockResolvedValue(json({ Policy: { EnableSubtitleManagement: true } }));
    expect(await canManageSubtitles()).toBe(true);
    expect(await canManageSubtitles()).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toBe("http://server:8096/Users/Me");
  });

  it("answers no when the policy lacks the flag or the read fails", async () => {
    mockFetch.mockResolvedValueOnce(json({ Policy: {} }));
    expect(await canManageSubtitles()).toBe(false);
    resetSubtitlePermission();
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    expect(await canManageSubtitles()).toBe(false);
  });
});

describe("server calls", () => {
  it("searches one language and keeps the status of a refusal", async () => {
    mockFetch.mockResolvedValueOnce(json([{ Id: "a" }]));
    expect(await searchRemoteSubtitles("item1", "eng")).toEqual({ status: 200, results: [{ Id: "a" }] });
    expect(mockFetch.mock.calls[0][0]).toBe("http://server:8096/Items/item1/RemoteSearch/Subtitles/eng");
    mockFetch.mockResolvedValueOnce(json("", 403));
    expect(await searchRemoteSubtitles("item1", "eng")).toEqual({ status: 403, results: [] });
  });

  it("posts a download and reads a provider file", async () => {
    mockFetch.mockResolvedValueOnce(json("", 204));
    expect(await downloadRemoteSubtitle("item1", "sub/1")).toBe(204);
    expect(mockFetch.mock.calls[0][0]).toBe("http://server:8096/Items/item1/RemoteSearch/Subtitles/sub%2F1");
    expect((mockFetch.mock.calls[0][1] as RequestInit).method).toBe("POST");
    mockFetch.mockResolvedValueOnce(json("1\n00:00:01,000 --> 00:00:02,000\nx"));
    expect(await fetchRemoteSubtitleFile("sub/1")).toEqual({ status: 200, text: "1\n00:00:01,000 --> 00:00:02,000\nx" });
    expect(mockFetch.mock.calls[1][0]).toBe("http://server:8096/Providers/Subtitles/Subtitles/sub%2F1");
  });

  it("uploads the file as base64 with its language, format and flags", async () => {
    mockFetch.mockResolvedValueOnce(json("", 204));
    expect(await uploadSubtitle("item1", { language3: "spa", format: "srt", isForced: false, isHearingImpaired: true, text: "héllo" })).toBe(204);
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://server:8096/Videos/item1/Subtitles");
    expect(JSON.parse(init.body as string)).toEqual({ Language: "spa", Format: "srt", IsForced: false, IsHearingImpaired: true, Data: "aMOpbGxv" });
  });
});

describe("toBase64Utf8", () => {
  it("encodes UTF-8 with padding", () => {
    expect(toBase64Utf8("")).toBe("");
    expect(toBase64Utf8("a")).toBe("YQ==");
    expect(toBase64Utf8("ab")).toBe("YWI=");
    expect(toBase64Utf8("abc")).toBe("YWJj");
    expect(toBase64Utf8("héllo")).toBe("aMOpbGxv");
  });
});

describe("waitForSubtitleStream", () => {
  const sleep = async () => undefined;

  it("re-reads the item past its cache until a new external text stream shows", async () => {
    mockDetails.mockResolvedValueOnce({ MediaStreams: [{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2 }] }).mockResolvedValueOnce({
      MediaStreams: [
        { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2 },
        { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 3, Language: "spa" },
      ],
    });
    const stream = await waitForSubtitleStream("item1", [2], { attempts: 5, sleep });
    expect(stream).toMatchObject({ Index: 3 });
    expect(mockInvalidate).toHaveBeenCalledWith("details:u:item1");
    expect(mockDetails).toHaveBeenCalledTimes(2);
  });

  it("gives up after the attempts, and ignores image sidecars", async () => {
    mockDetails.mockResolvedValue({ MediaStreams: [{ Type: "Subtitle", Codec: "pgssub", IsExternal: true, Index: 9 }] });
    expect(await waitForSubtitleStream("item1", [], { attempts: 3, sleep })).toBeNull();
    expect(mockDetails).toHaveBeenCalledTimes(3);
  });

  it("lists external text streams only", () => {
    expect(
      externalTextStreams([
        { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 1 },
        { Type: "Subtitle", Codec: "subrip", IsExternal: false, Index: 2 },
        { Type: "Subtitle", Codec: "pgssub", IsExternal: true, Index: 3 },
        { Type: "Audio", Codec: "aac", Index: 4 },
      ]).map((stream) => stream.Index),
    ).toEqual([1]);
  });
});
