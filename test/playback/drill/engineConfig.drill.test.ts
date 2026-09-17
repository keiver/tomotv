/**
 * Captures the exact engine config the app's startLocalRemux hands the native bridge, for the
 * host Slipstream drill (native/ios/Tests/TomoEngineTests/SlipstreamDrillTests.swift). Skipped
 * unless DRILL_ITEM_ID is set; scripts/abr-drill.mjs sets the rest.
 *
 * Env: DRILL_ITEM_ID, DRILL_OUT (json path), DRILL_SERVER (the URL the config points at, the
 * netsim proxy), DRILL_UPSTREAM (where the item is read from), DRILL_API_KEY, DRILL_START (s).
 */
import fs from "node:fs";
import http from "node:http";
import { startLocalRemux } from "@/services/localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const mockCaptured: { config?: unknown } = {};

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {
    LocalRemuxer: {
      startRemux: async (config: unknown) => {
        mockCaptured.config = config;
        return "http://127.0.0.1:1/drill/master.m3u8";
      },
      stopRemux: async () => undefined,
      // Apple TV 4K (3rd generation), as DeviceDecode.summary() reports it on the drill TV.
      videoDecodeSupport: async () => ({ hevc: true, hevcMain10: true, av1: false, h264MaxHeight: 4320, hevcMaxHeight: 4320 }),
      events: ["onEnginePlan", "onEngineThroughput", "onEngineTier", "onEngineFailed"],
    },
  },
  NativeEventEmitter: class {
    addListener() {
      return { remove: () => undefined };
    }
  },
}));
jest.mock("@/services/playbackProbe", () => ({ probeEmit: () => undefined, noteDeviceDecode: () => undefined }));
jest.mock("@/services/engineVerdicts", () => ({ rememberedVerdict: async () => null }));
jest.mock("@/services/jellyfin/bitrateTest", () => ({ rememberedBitrate: async () => null, measureServerBitrate: async () => null }));
jest.mock("@/services/jellyfin/session", () => ({
  getCachedConfig: () => ({ server: process.env.DRILL_SERVER, apiKey: process.env.DRILL_API_KEY, userId: "drill" }),
  generatePlaySessionId: () => `drill${Math.random().toString(36).slice(2, 10)}`,
}));

const run = process.env.DRILL_ITEM_ID ? it : it.skip;

describe("Slipstream drill engine config", () => {
  run("writes the bridge config startLocalRemux builds for the item", async () => {
    const upstream = process.env.DRILL_UPSTREAM ?? "http://127.0.0.1:8096";
    // jest-expo replaces global fetch, so the item is read with node's own client.
    const body = await new Promise<string>((resolve, reject) => {
      http
        .get(`${upstream}/Items?Ids=${process.env.DRILL_ITEM_ID}&Fields=MediaSources,MediaStreams`, { headers: { Authorization: `MediaBrowser Token="${process.env.DRILL_API_KEY}"` } }, (res) => {
          let text = "";
          res.on("data", (chunk) => (text += chunk));
          res.on("end", () => resolve(text));
        })
        .on("error", reject);
    });
    const { Items } = JSON.parse(body) as { Items: (JellyfinVideoItem & { MediaSources?: { MediaStreams?: unknown }[] })[] };
    const item = Items[0];
    expect(item).toBeDefined();
    // Items carries the streams on the media source; PlaybackInfo (what the app reads) also lifts them to the item.
    const detailed = { ...item, MediaStreams: item.MediaStreams ?? item.MediaSources?.[0]?.MediaStreams } as JellyfinVideoItem;
    await startLocalRemux(detailed, undefined, Number(process.env.DRILL_START ?? "0") || undefined);
    expect(mockCaptured.config).toBeDefined();
    fs.writeFileSync(process.env.DRILL_OUT ?? "drill-config.json", JSON.stringify(mockCaptured.config, null, 2));
  });
});
