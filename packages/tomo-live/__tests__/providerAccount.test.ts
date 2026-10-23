/** providerAccount - an Xtream-style provider's streams in use, read from its player API without opening a stream. */
import { providerApiUrl, providerStreamsInUse } from "../src/providerAccount";

const mockFetch = jest.fn();
beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

it("finds the account in a live stream URL with or without the live segment, and nothing in other shapes", () => {
  expect(providerApiUrl("http://iptv.example:9191/live/one/pass%201/2?output_format=ts")).toBe("http://iptv.example:9191/player_api.php?username=one&password=pass%201");
  expect(providerApiUrl("http://iptv.example/one/secret/77.ts")).toBe("http://iptv.example/player_api.php?username=one&password=secret");
  expect(providerApiUrl("https://cdn.example/channels/news/index.m3u8?token=x")).toBe("https://cdn.example/player_api.php?username=channels&password=news");
  expect(providerApiUrl("https://cdn.example/news/master.m3u8")).toBeNull();
  expect(providerApiUrl("not a url")).toBeNull();
});

it("reads the account's streams in use and allowed", async () => {
  mockFetch.mockResolvedValue({ ok: true, json: async () => ({ user_info: { active_cons: "1", max_connections: "1" } }) });
  expect(await providerStreamsInUse("http://iptv.example/live/one/secret/2")).toEqual({ active: 1, max: 1 });
});

it("is null for a provider without the player API or an answer it cannot read", async () => {
  mockFetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
  expect(await providerStreamsInUse("http://iptv.example/live/one/secret/2")).toBeNull();
  mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ user_info: {} }) });
  expect(await providerStreamsInUse("http://iptv.example/live/one/secret/2")).toBeNull();
  mockFetch.mockRejectedValueOnce(new Error("offline"));
  expect(await providerStreamsInUse("http://iptv.example/live/one/secret/2")).toBeNull();
  expect(await providerStreamsInUse("https://cdn.example/news/master.m3u8")).toBeNull();
  expect(mockFetch).toHaveBeenCalledTimes(3);
});
