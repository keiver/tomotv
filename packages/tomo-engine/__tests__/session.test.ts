/** session - the typed calls over LocalRemuxer's session, shim and frame provider methods. */

let mockRemuxer: Record<string, jest.Mock> | undefined;
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: {
    get LocalRemuxer() {
      return mockRemuxer;
    },
  },
  NativeEventEmitter: jest.fn(),
}));

jest.mock("../src/events", () => ({
  attributeSession: jest.fn(),
  forgetSession: jest.fn(),
  watchEngineLink: jest.fn(),
  watchEnginePlan: jest.fn(),
  watchEngineStage: jest.fn(),
  watchEngineTier: jest.fn(),
}));

import { configureEngine } from "../src/config";
import * as events from "../src/events";
import {
  type EngineSessionConfig,
  engineProgress,
  liveSubtitleRenditions,
  localRemuxToken,
  reportPlayerBuffer,
  setLiveSessionPriority,
  setLiveWindow,
  startFrameProvider,
  startPlaylistShim,
  startSession,
  stopFrameProvider,
  stopLocalRemux,
  stopPlaylistShim,
} from "../src/session";
import { fittedIFrameSize, iframeStreamInf } from "../src/tags";

const MASTER = "http://127.0.0.1:52000/tok123/master.m3u8";
const warn = jest.fn();
configureEngine({ log: { debug: jest.fn(), info: jest.fn(), warn } });

const config = { inputUrl: "http://origin/file.mkv", itemId: "item1" } as EngineSessionConfig;

beforeEach(() => {
  jest.clearAllMocks();
  mockRemuxer = { startRemux: jest.fn().mockResolvedValue(MASTER), stopRemux: jest.fn().mockResolvedValue(undefined) };
});

describe("startSession", () => {
  it("throws without the native module", async () => {
    mockRemuxer = undefined;
    await expect(startSession(config)).rejects.toThrow("not available");
  });

  it("watches plan and tier before the call and attributes the token after it", async () => {
    await expect(startSession(config, { tierDeclared: true })).resolves.toBe(MASTER);
    expect(mockRemuxer!.startRemux).toHaveBeenCalledWith(config);
    expect(events.watchEnginePlan).toHaveBeenCalled();
    expect(events.watchEngineTier).toHaveBeenCalled();
    expect(events.attributeSession).toHaveBeenCalledWith("tok123", true);
    expect((events.watchEnginePlan as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(mockRemuxer!.startRemux.mock.invocationCallOrder[0]);
  });

  it("leaves an unattributed session out of plan and tier but still watches link and stage", async () => {
    await startSession(config, { attributePlan: false });
    expect(events.watchEnginePlan).not.toHaveBeenCalled();
    expect(events.watchEngineTier).not.toHaveBeenCalled();
    expect(events.attributeSession).not.toHaveBeenCalled();
    expect(events.watchEngineLink).toHaveBeenCalled();
    expect(events.watchEngineStage).toHaveBeenCalled();
  });
});

describe("localRemuxToken", () => {
  it("reads the path segment before master.m3u8", () => {
    expect(localRemuxToken(MASTER)).toBe("tok123");
  });

  it("is null without a URL", () => {
    expect(localRemuxToken(null)).toBeNull();
    expect(localRemuxToken(undefined)).toBeNull();
  });
});

describe("stopLocalRemux", () => {
  it("forgets the session and stops it", async () => {
    await stopLocalRemux("tok123");
    expect(events.forgetSession).toHaveBeenCalledWith("tok123");
    expect(mockRemuxer!.stopRemux).toHaveBeenCalledWith("tok123");
  });

  it("does nothing without a token", async () => {
    await stopLocalRemux(null);
    expect(mockRemuxer!.stopRemux).not.toHaveBeenCalled();
  });

  it("logs a failed stop instead of throwing", async () => {
    mockRemuxer!.stopRemux.mockRejectedValue(new Error("gone"));
    await expect(stopLocalRemux("tok123")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Failed to stop local remux session", expect.any(Error), expect.objectContaining({ token: "tok123" }));
  });
});

describe("live session controls", () => {
  it("skip a binary without the method", async () => {
    await expect(setLiveWindow("tok123", 30)).resolves.toBeUndefined();
    await expect(setLiveSessionPriority("tok123", "playback")).resolves.toBeUndefined();
  });

  it("forward the window and the priority", async () => {
    mockRemuxer!.setLiveWindow = jest.fn().mockResolvedValue(undefined);
    mockRemuxer!.setLivePriority = jest.fn().mockResolvedValue(undefined);
    await setLiveWindow("tok123", 30);
    await setLiveSessionPriority("tok123", "ring");
    expect(mockRemuxer!.setLiveWindow).toHaveBeenCalledWith("tok123", 30);
    expect(mockRemuxer!.setLivePriority).toHaveBeenCalledWith("tok123", "ring");
  });

  it("log a rejected call", async () => {
    mockRemuxer!.setLiveWindow = jest.fn().mockRejectedValue(new Error("x"));
    await setLiveWindow("tok123", 30);
    expect(warn).toHaveBeenCalledWith("Failed to resize a live window", expect.any(Error), expect.objectContaining({ token: "tok123" }));
  });
});

describe("reportPlayerBuffer", () => {
  it("resolves the floor the engine answers", async () => {
    mockRemuxer!.setPlayerBuffer = jest.fn().mockResolvedValue(4_000_000);
    await expect(reportPlayerBuffer("tok123", 12.5, true)).resolves.toBe(4_000_000);
    expect(mockRemuxer!.setPlayerBuffer).toHaveBeenCalledWith("tok123", 12.5, true);
  });

  it("is 0 for a non-finite buffer, a non-number answer or a rejection", async () => {
    mockRemuxer!.setPlayerBuffer = jest.fn().mockResolvedValue("x");
    await expect(reportPlayerBuffer("tok123", Number.NaN, false)).resolves.toBe(0);
    expect(mockRemuxer!.setPlayerBuffer).not.toHaveBeenCalled();
    await expect(reportPlayerBuffer("tok123", 5, false)).resolves.toBe(0);
    mockRemuxer!.setPlayerBuffer.mockRejectedValue(new Error("x"));
    await expect(reportPlayerBuffer("tok123", 5, false)).resolves.toBe(0);
  });
});

describe("engineProgress", () => {
  it("is null without the method or the required numbers", async () => {
    await expect(engineProgress("tok123")).resolves.toBeNull();
    mockRemuxer!.engineProgress = jest.fn().mockResolvedValue({ alive: true, bytesRead: 10 });
    await expect(engineProgress("tok123")).resolves.toBeNull();
  });

  it("keeps the optional fields only when well typed", async () => {
    mockRemuxer!.engineProgress = jest.fn().mockResolvedValue({
      alive: true,
      bytesRead: 10,
      readSeconds: 1,
      elapsedSeconds: 2,
      sourceState: "reading",
      recovering: "no",
      hasPlayableSupplier: false,
      sourceRetryAfterSeconds: -1,
    });
    await expect(engineProgress("tok123")).resolves.toEqual({ alive: true, bytesRead: 10, readSeconds: 1, elapsedSeconds: 2, sourceState: "reading", hasPlayableSupplier: false });
  });
});

describe("liveSubtitleRenditions", () => {
  it("maps the tracks, keeping the first default only and filling an empty language", async () => {
    mockRemuxer!.liveSubtitles = jest.fn().mockResolvedValue([
      { index: 3, name: "English", language: "eng", isDefault: true, isForced: false, isImage: false },
      { index: 4, name: "Teletext", language: "", isDefault: true, isForced: false, isImage: true },
    ]);
    const renditions = await liveSubtitleRenditions("tok123");
    expect(renditions?.map((r) => [r.index, r.language, r.isDefault, r.isImage])).toEqual([
      [3, "eng", true, false],
      [4, "und", false, true],
    ]);
  });

  it("is null for an unknown answer", async () => {
    mockRemuxer!.liveSubtitles = jest.fn().mockResolvedValue(null);
    await expect(liveSubtitleRenditions("tok123")).resolves.toBeNull();
    await expect(liveSubtitleRenditions(null)).resolves.toBeNull();
  });
});

describe("startPlaylistShim", () => {
  it("is null with neither a resume offset nor an SDR retag", async () => {
    mockRemuxer!.startPlaylistShim = jest.fn();
    await expect(startPlaylistShim("http://server/master.m3u8", 0)).resolves.toBeNull();
    expect(mockRemuxer!.startPlaylistShim).not.toHaveBeenCalled();
  });

  it("starts for an SDR retag alone, offset clamped to 0", async () => {
    mockRemuxer!.startPlaylistShim = jest.fn().mockResolvedValue("http://127.0.0.1/shim/master.m3u8");
    await expect(startPlaylistShim("http://server/master.m3u8", -5, { sdrInit: true })).resolves.toBe("http://127.0.0.1/shim/master.m3u8");
    expect(mockRemuxer!.startPlaylistShim).toHaveBeenCalledWith({ masterUrl: "http://server/master.m3u8", startOffsetSeconds: 0, sdrInit: true });
  });

  it("is null when the shim fails", async () => {
    mockRemuxer!.startPlaylistShim = jest.fn().mockRejectedValue(new Error("x"));
    await expect(startPlaylistShim("http://server/master.m3u8", 30)).resolves.toBeNull();
  });

  it("starts for an I-frame line alone and hands it to the master", async () => {
    mockRemuxer!.startPlaylistShim = jest.fn().mockResolvedValue("http://127.0.0.1/shim/master.m3u8");
    const line = '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=1,URI="http://127.0.0.1/frame-x/iframes.m3u8"';
    await expect(startPlaylistShim("http://server/master.m3u8", 0, { iframeStreamInf: line })).resolves.toBe("http://127.0.0.1/shim/master.m3u8");
    expect(mockRemuxer!.startPlaylistShim).toHaveBeenCalledWith({ masterUrl: "http://server/master.m3u8", startOffsetSeconds: 0, sdrInit: false, iframeStreamInf: line });
  });
});

describe("startFrameProvider", () => {
  it("is null without an input", async () => {
    mockRemuxer!.startFrameProvider = jest.fn();
    await expect(startFrameProvider("", "item1")).resolves.toBeNull();
    expect(mockRemuxer!.startFrameProvider).not.toHaveBeenCalled();
  });

  it("passes the input and item", async () => {
    mockRemuxer!.startFrameProvider = jest.fn().mockResolvedValue("http://127.0.0.1/frames/");
    await expect(startFrameProvider("http://origin/file.mkv", "item1")).resolves.toBe("http://127.0.0.1/frames/");
    expect(mockRemuxer!.startFrameProvider).toHaveBeenCalledWith({ inputUrl: "http://origin/file.mkv", itemId: "item1" });
  });

  it("is null when the provider will not start", async () => {
    mockRemuxer!.startFrameProvider = jest.fn().mockRejectedValue(new Error("x"));
    await expect(startFrameProvider("http://origin/file.mkv", "item1")).resolves.toBeNull();
    expect(warn).toHaveBeenCalledWith("Failed to start frame provider", expect.any(Error), expect.anything());
  });

  it("passes an I-frame rendition when asked for one", async () => {
    mockRemuxer!.startFrameProvider = jest.fn().mockResolvedValue("http://127.0.0.1/frames/");
    await startFrameProvider("http://origin/file.mkv", "item1", { transcode: true, durationSeconds: 600 });
    expect(mockRemuxer!.startFrameProvider).toHaveBeenCalledWith({ inputUrl: "http://origin/file.mkv", itemId: "item1", iframes: { transcode: true, durationSeconds: 600 } });
  });
});

describe("stopping a shim or a provider", () => {
  it("does nothing without a token", async () => {
    mockRemuxer!.stopPlaylistShim = jest.fn();
    mockRemuxer!.stopFrameProvider = jest.fn();
    await stopPlaylistShim(null);
    await stopFrameProvider(null);
    expect(mockRemuxer!.stopPlaylistShim).not.toHaveBeenCalled();
    expect(mockRemuxer!.stopFrameProvider).not.toHaveBeenCalled();
  });

  it("stops by token, and logs a refusal instead of throwing", async () => {
    mockRemuxer!.stopPlaylistShim = jest.fn().mockResolvedValue(undefined);
    mockRemuxer!.stopFrameProvider = jest.fn().mockRejectedValue(new Error("gone"));
    await stopPlaylistShim("shim-1");
    await expect(stopFrameProvider("frame-1")).resolves.toBeUndefined();
    expect(mockRemuxer!.stopPlaylistShim).toHaveBeenCalledWith("shim-1");
    expect(warn).toHaveBeenCalledWith("Failed to stop frame provider", expect.any(Error), expect.objectContaining({ token: "frame-1" }));
    mockRemuxer!.stopPlaylistShim = jest.fn().mockRejectedValue(new Error("gone"));
    await expect(stopPlaylistShim("shim-1")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith("Failed to stop playlist shim", expect.any(Error), expect.objectContaining({ token: "shim-1" }));
  });
});

describe("iframeStreamInf", () => {
  const line = { bandwidth: 2_000_000.4, averageBandwidth: 1_000_000, codecs: "avc1.640028", width: 1920, height: 800 };

  it("names the provider's playlist with its peak, mean, codec, size and SDR range", () => {
    expect(iframeStreamInf("http://127.0.0.1:9/frame-a/", line)).toBe(
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=2000000,AVERAGE-BANDWIDTH=1000000,CODECS="avc1.640028",RESOLUTION=1920x800,VIDEO-RANGE=SDR,URI="http://127.0.0.1:9/frame-a/iframes.m3u8"',
    );
  });

  it("never declares a mean above the peak, and leaves an unknown size out", () => {
    expect(iframeStreamInf("http://h/", { ...line, averageBandwidth: 9_000_000, width: 0 })).toBe(
      '#EXT-X-I-FRAME-STREAM-INF:BANDWIDTH=2000000,AVERAGE-BANDWIDTH=2000000,CODECS="avc1.640028",VIDEO-RANGE=SDR,URI="http://h/iframes.m3u8"',
    );
  });
});

describe("fittedIFrameSize", () => {
  it("fits inside 1920x1080 on both axes, even, keeping the shape", () => {
    expect(fittedIFrameSize(3840, 1600)).toEqual({ width: 1920, height: 800 });
    expect(fittedIFrameSize(3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(fittedIFrameSize(1440, 1440)).toEqual({ width: 1080, height: 1080 });
  });

  it("never enlarges a smaller picture", () => {
    expect(fittedIFrameSize(960, 720)).toEqual({ width: 960, height: 720 });
  });
});
