/** posterFrames - what a poster request hands the engine about its origin. */

const mockPosterFrame = jest.fn();
jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  NativeModules: { LocalRemuxer: { startRemux: jest.fn(), posterFrame: (config: unknown) => mockPosterFrame(config), cancelPosterFrame: jest.fn() } },
  NativeEventEmitter: jest.fn(),
}));

import { clearPosterFrameCache, requestPosterFrame } from "../src/posterFrames";

beforeEach(() => {
  jest.clearAllMocks();
  clearPosterFrameCache();
  mockPosterFrame.mockResolvedValue({ uri: "file:///pool/a/poster.jpg", cancelled: false });
});

describe("requestPosterFrame", () => {
  it("names nothing about the origin unless the request does", async () => {
    await requestPosterFrame({ id: "a", inputUrl: () => "http://origin/a.mkv", seconds: 60 });
    expect(mockPosterFrame).toHaveBeenCalledWith({ itemId: "a", inputUrl: "http://origin/a.mkv", seconds: 60 });
  });

  it("passes the origin's headers and the provider whose budget the read spends", async () => {
    await requestPosterFrame({ id: "b", inputUrl: () => "http://origin/b.mkv", seconds: 60, httpHeaders: { "User-Agent": "x" }, originKey: "provider-a" });
    expect(mockPosterFrame).toHaveBeenCalledWith({ itemId: "b", inputUrl: "http://origin/b.mkv", seconds: 60, httpHeaders: { "User-Agent": "x" }, originKey: "provider-a" });
  });
});
