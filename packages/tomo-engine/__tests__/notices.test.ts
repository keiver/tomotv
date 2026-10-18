/** notices - SpatialAudioBridge's license notices over LocalRemuxer. */

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

import { spatialAudioNotices } from "../src/notices";

describe("spatialAudioNotices", () => {
  it("returns the text the engine reads from the package", async () => {
    mockRemuxer = { startRemux: jest.fn(), spatialAudioNotices: jest.fn(async () => "SpatialAudioBridge notices") };
    await expect(spatialAudioNotices()).resolves.toBe("SpatialAudioBridge notices");
  });

  it("returns null from a build without the method, an empty answer or a rejection", async () => {
    mockRemuxer = { startRemux: jest.fn() };
    await expect(spatialAudioNotices()).resolves.toBeNull();
    mockRemuxer = { startRemux: jest.fn(), spatialAudioNotices: jest.fn(async () => "") };
    await expect(spatialAudioNotices()).resolves.toBeNull();
    mockRemuxer = { startRemux: jest.fn(), spatialAudioNotices: jest.fn(async () => Promise.reject(new Error("gone"))) };
    await expect(spatialAudioNotices()).resolves.toBeNull();
  });
});
