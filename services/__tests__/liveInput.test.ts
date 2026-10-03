/**
 * The raw TS lane: which channels read their origin, which the server's pass-through, which keep a server open.
 */
import { NativeModules } from "react-native";
import { originKeyOf, rawLiveInput, resetLiveInput, splitPipeHeaders } from "../jellyfin/liveInput";
import type { JellyfinMediaSource } from "@/types/jellyfin";

const SERVER = "http://192.168.1.100:8096";
const UA = { "User-Agent": "Mozilla/5.0 Chrome" };
const probeOriginReach = jest.fn();

const source = (overrides: Partial<JellyfinMediaSource> = {}): JellyfinMediaSource =>
  ({ Id: "ms", Path: "http://provider.example:8080/live/u/p/101.ts", Protocol: "Http", SupportsDirectPlay: true, RequiredHttpHeaders: UA, ...overrides }) as JellyfinMediaSource;

describe("raw live input", () => {
  beforeEach(() => {
    resetLiveInput();
    probeOriginReach.mockReset().mockResolvedValue("reachable");
    NativeModules.LocalRemuxer = { ...(NativeModules.LocalRemuxer ?? {}), probeOriginReach, setLivePriority: jest.fn() };
  });

  it("splits a playlist line's pipe headers as the native parser does", () => {
    expect(splitPipeHeaders("http://h/1.ts|User-Agent=VLC%2F3.0&Referrer=http%3A%2F%2Fr&!X-Id=7&=bad")).toEqual({
      url: "http://h/1.ts",
      headers: { "user-agent": "VLC/3.0", referer: "http://r", "x-id": "7" },
    });
    expect(splitPipeHeaders("http://h/1.ts")).toEqual({ url: "http://h/1.ts", headers: {} });
  });

  it("keys a provider by host, credentials and port aside", () => {
    expect(originKeyOf("http://user:pass@Provider.Example:8080/live/1.ts")).toBe("provider.example");
    expect(originKeyOf("https://[2001:db8::1]:443/x.ts")).toBe("[2001:db8::1]");
  });

  it("reads a reachable origin with the server's User-Agent under the line's headers, the pass-through as fallback", async () => {
    const input = await rawLiveInput(SERVER, "k", "ch1", source({ Path: "http://provider.example:8080/1.ts|user-agent=Own%2F1&Referer=x" }));
    expect(input).toEqual({
      url: "http://provider.example:8080/1.ts",
      headers: { "user-agent": "Own/1", referer: "x" },
      originKey: "provider.example",
      fallbackUrl: `${SERVER}/Videos/ch1/stream?static=true&ApiKey=k`,
      via: "origin",
    });
  });

  it("reads through the server when this device cannot reach the host, still on the provider's budget", async () => {
    probeOriginReach.mockResolvedValue("refused");
    const input = await rawLiveInput(SERVER, "k", "ch1", source({ Path: "http://127.0.0.1:9102/live.ts" }));
    expect(input).toEqual({ url: `${SERVER}/Videos/ch1/stream?static=true&ApiKey=k`, originKey: "127.0.0.1", via: "server" });
  });

  it("asks a host's reach once, then again after a server switch", async () => {
    await rawLiveInput(SERVER, "k", "ch1", source());
    await rawLiveInput(SERVER, "k", "ch2", source({ Path: "http://provider.example:8080/live/u/p/102.ts" }));
    expect(probeOriginReach).toHaveBeenCalledTimes(1);
    resetLiveInput();
    await rawLiveInput(SERVER, "k", "ch1", source());
    expect(probeOriginReach).toHaveBeenCalledTimes(2);
  });

  it("leaves to a server open what the server itself will not direct play", async () => {
    // A tuner stream limit or looping turns direct play off; HDHomeRun answers Udp; a manifest has its own lane.
    await expect(rawLiveInput(SERVER, "k", "c", source({ SupportsDirectPlay: false }))).resolves.toBeNull();
    await expect(rawLiveInput(SERVER, "k", "c", source({ Protocol: "Udp" }))).resolves.toBeNull();
    await expect(rawLiveInput(SERVER, "k", "c", source({ Path: "http://provider.example/live/index.m3u8" }))).resolves.toBeNull();
    expect(probeOriginReach).not.toHaveBeenCalled();
  });

  it("keeps the server open on a native build without the connection broker", async () => {
    NativeModules.LocalRemuxer = { ...NativeModules.LocalRemuxer, setLivePriority: undefined };
    await expect(rawLiveInput(SERVER, "k", "c", source())).resolves.toBeNull();
  });
});
