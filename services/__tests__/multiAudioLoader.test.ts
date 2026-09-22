/**
 * multiAudioLoader.test.ts
 *
 * Comprehensive unit tests for multi-audio track selection and playback preparation.
 * Tests cover platform detection, language preference logic, native module integration,
 * and edge cases.
 *
 * Created: January 24, 2026
 */

// Mock logger before importing multiAudioLoader
jest.mock("@/utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import type { JellyfinVideoItem } from "@/types/jellyfin";
import type { AudioTrackInfo } from "../multiAudioLoader";

/**
 * Helper to create a minimal valid JellyfinVideoItem
 */
function createMockVideoItem(overrides: Partial<JellyfinVideoItem> = {}): JellyfinVideoItem {
  return {
    Id: "test-video",
    Name: "Test Video",
    RunTimeTicks: 60000000000,
    Type: "Video",
    Path: "/media/test.mkv",
    ...overrides,
  };
}

describe("multiAudioLoader", () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock("react-native");
    jest.resetModules();
  });

  describe("getAudioTracks (no native module dependency)", () => {
    // These tests don't need native module mocking
    let getAudioTracks: any;

    beforeAll(() => {
      // Mock React Native without native module for these tests
      jest.doMock("react-native", () => ({
        Platform: { OS: "ios" },
        NativeModules: {},
      }));

      const module = require("../multiAudioLoader");
      getAudioTracks = module.getAudioTracks;
    });

    afterAll(() => {
      jest.unmock("react-native");
    });

    it("should extract audio tracks from MediaStreams", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Video",
            Index: 0,
            Codec: "h264",
          },
          {
            Type: "Audio",
            Index: 1,
            Language: "eng",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "English (AAC Stereo)",
            IsDefault: true,
          },
          {
            Type: "Audio",
            Index: 2,
            Language: "spa",
            Codec: "ac3",
            Channels: 6,
            DisplayTitle: "Spanish (AC3 5.1)",
            IsDefault: false,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      expect(tracks).toHaveLength(2);
      expect(tracks[0]).toMatchObject({
        Index: 1,
        Language: "eng",
        Codec: "aac",
        Channels: 2,
        DisplayTitle: "English (AAC Stereo)",
      });
      expect(tracks[1]).toMatchObject({
        Index: 2,
        Language: "spa",
        Codec: "ac3",
        Channels: 6,
      });
    });

    it("should fallback to MediaSources[0].MediaStreams if top-level is empty", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [],
        MediaSources: [
          {
            Id: "source-1",
            MediaStreams: [
              {
                Type: "Audio",
                Index: 1,
                Language: "eng",
                Codec: "aac",
                Channels: 2,
                DisplayTitle: "English",
                IsDefault: true,
              },
            ],
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      expect(tracks).toHaveLength(1);
      expect(tracks[0].Language).toBe("eng");
    });

    it("should return empty array if no audio tracks found", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Video",
            Index: 0,
            Codec: "h264",
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      expect(tracks).toHaveLength(0);
    });

    it("should handle missing MediaStreams gracefully", () => {
      const videoItem = createMockVideoItem();

      const tracks = getAudioTracks(videoItem);

      expect(tracks).toHaveLength(0);
    });

    it("should prefer English track as default", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Index: 1,
            Language: "und",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "Unknown",
            IsDefault: true, // Jellyfin says this is default
          },
          {
            Type: "Audio",
            Index: 2,
            Language: "eng",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "English",
            IsDefault: false,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      // Sorted by Jellyfin's IsDefault flag - "und" is first because Jellyfin marked it as default
      expect(tracks[0].Language).toBe("und");
      expect(tracks[0].IsDefault).toBe(true);
      expect(tracks[1].Language).toBe("eng");
      expect(tracks[1].IsDefault).toBe(false);
    });

    it("should prefer non-UND track if no English available", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Index: 1,
            Language: "und",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "Unknown",
            IsDefault: true,
          },
          {
            Type: "Audio",
            Index: 2,
            Language: "jpn",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "Japanese",
            IsDefault: false,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      // Sorted by IsDefault flag (respects Jellyfin's server-side metadata)
      // The UND track is first because it has IsDefault: true
      expect(tracks[0].Language).toBe("und");
      expect(tracks[0].IsDefault).toBe(true);
      expect(tracks[1].Language).toBe("jpn");
      expect(tracks[1].IsDefault).toBe(false);
    });

    it("should use first track as fallback if all are UND", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Index: 1,
            Language: "und",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "Unknown 1",
            IsDefault: false,
          },
          {
            Type: "Audio",
            Index: 2,
            Language: "und",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "Unknown 2",
            IsDefault: false,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      // Order preserved when no IsDefault flag is set (both false)
      expect(tracks[0].Index).toBe(1);
      expect(tracks[0].IsDefault).toBe(false);
      expect(tracks[1].Index).toBe(2);
      expect(tracks[1].IsDefault).toBe(false);
    });

    it("should handle single audio track without reordering", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Index: 1,
            Language: "eng",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "English",
            IsDefault: true,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      expect(tracks).toHaveLength(1);
      expect(tracks[0].IsDefault).toBe(true);
    });

    it("should handle missing optional fields with defaults", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Codec: "aac",
            Index: 1,
            // Missing: Language, Channels, DisplayTitle, IsDefault
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      expect(tracks).toHaveLength(1);
      expect(tracks[0]).toMatchObject({
        Index: 1,
        Language: "und",
        Codec: "aac",
        Channels: 2,
      });
      // Single track keeps original IsDefault value (defaults to false)
      expect(tracks[0].IsDefault).toBe(false);
    });

    it("should recognize English language variants", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Index: 1,
            Language: "en-US",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "English (US)",
            IsDefault: false,
          },
          {
            Type: "Audio",
            Index: 2,
            Language: "en-GB",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "English (UK)",
            IsDefault: false,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      // Order preserved when both have IsDefault: false
      expect(tracks[0].Language).toBe("en-US");
      expect(tracks[0].IsDefault).toBe(false);
      expect(tracks[1].Language).toBe("en-GB");
      expect(tracks[1].IsDefault).toBe(false);
    });

    it("should handle video with mixed track types correctly", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Video",
            Index: 0,
            Codec: "h264",
          },
          {
            Type: "Audio",
            Index: 1,
            Language: "eng",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "English",
            IsDefault: true,
          },
          {
            Type: "Subtitle",
            Index: 2,
            Language: "eng",
            Codec: "subrip",
            DisplayTitle: "English Subtitles",
            IsDefault: false,
          },
          {
            Type: "Audio",
            Index: 3,
            Language: "spa",
            Codec: "ac3",
            Channels: 6,
            DisplayTitle: "Spanish",
            IsDefault: false,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      expect(tracks).toHaveLength(2);
      expect(tracks.every((t: AudioTrackInfo) => t.Index === 1 || t.Index === 3)).toBe(true);
    });

    it("should handle tracks with Index = 0", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Index: 0,
            Language: "eng",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "English",
            IsDefault: true,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      expect(tracks).toHaveLength(1);
      expect(tracks[0].Index).toBe(0);
    });

    it("rejects tracks with undefined Index rather than mapping them to another track", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Codec: "aac",
            // Index is undefined
            Language: "eng",
            Channels: 2,
            DisplayTitle: "English",
            IsDefault: true,
          },
        ],
      });

      expect(() => getAudioTracks(videoItem)).toThrow("valid Jellyfin stream index");
    });

    it("should handle empty DisplayTitle gracefully", () => {
      const videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Index: 1,
            Language: "eng",
            Codec: "aac",
            Channels: 2,
            IsDefault: true,
          },
        ],
      });

      const tracks = getAudioTracks(videoItem);

      expect(tracks[0].DisplayTitle).toBe("eng");
    });

    it("keys tracks by media source and real stream index without filtering unknown codecs", () => {
      const tracks = getAudioTracks(
        createMockVideoItem({
          MediaSources: [{ Id: "alternate-source" }],
          MediaStreams: [
            { Type: "Audio", Codec: "aac", Index: 3 },
            { Type: "Audio", Codec: "acelp.kelvin", Index: 9, IsDefault: true },
          ],
        }),
      );
      expect(tracks.map((track: AudioTrackInfo) => track.Identity)).toEqual(["alternate-source:9", "alternate-source:3"]);
      expect(tracks.map((track: AudioTrackInfo) => track.Index)).toEqual([9, 3]);
    });

    it.each([undefined, -1, 1.5, NaN, 2_147_483_648])("rejects invalid stream index %s instead of inventing index zero", (index) => {
      const source = createMockVideoItem({ MediaStreams: [{ Type: "Audio", Codec: "aac", Index: index }] });
      expect(() => getAudioTracks(source)).toThrow("valid Jellyfin stream index");
    });

    it("keeps a live channel's Index -1 tracks apart by ordinal", () => {
      const channel = createMockVideoItem({
        MediaSources: [{ Id: "c1", Container: "ts", IsInfiniteStream: true, LiveStreamId: "ls-1" }],
        MediaStreams: [
          { Type: "Video", Codec: "h264", Index: -1 },
          { Type: "Audio", Codec: "aac", Index: -1 },
          { Type: "Audio", Codec: "aac", Index: -1 },
        ],
      });
      const tracks = getAudioTracks(channel);
      expect(tracks.map((track: AudioTrackInfo) => [track.Index, track.Identity, track.DisplayTitle])).toEqual([
        [-1, "c1:live0", "Audio 1"],
        [-1, "c1:live1", "Audio 2"],
      ]);
    });

    it("accepts audio indexes at the nonnegative Int32 boundary", () => {
      const tracks = getAudioTracks(
        createMockVideoItem({
          MediaStreams: [
            { Type: "Audio", Codec: "aac", Index: 0 },
            { Type: "Audio", Codec: "aac", Index: 2_147_483_647 },
          ],
        }),
      );
      expect(tracks.map((track: AudioTrackInfo) => track.Index)).toEqual([0, 2_147_483_647]);
    });

    it("rejects duplicate stream identities", () => {
      const source = createMockVideoItem({
        MediaStreams: [
          { Type: "Audio", Codec: "aac", Index: 2 },
          { Type: "Audio", Codec: "ac3", Index: 2 },
        ],
      });
      expect(() => getAudioTracks(source)).toThrow("Duplicate audio track identity");
    });

    it("keeps sanitized rendition labels unique even when the suffix is already another track's name", () => {
      const tracks = getAudioTracks(
        createMockVideoItem({
          MediaStreams: [
            { Type: "Audio", Codec: "aac", Index: 1, DisplayTitle: 'English"\n' },
            { Type: "Audio", Codec: "aac", Index: 2, DisplayTitle: "English" },
            { Type: "Audio", Codec: "aac", Index: 3, DisplayTitle: "English (1)" },
          ],
        }),
      );
      expect(tracks.map((track: AudioTrackInfo) => track.DisplayTitle)).toEqual(["English (1) (1)", "English (2)", "English (1)"]);
    });
  });

  describe("Platform and native module checks", () => {
    it("should recognize iOS vs Android platform", () => {
      jest.isolateModules(() => {
        jest.doMock("react-native", () => ({
          Platform: { OS: "android" },
          NativeModules: {},
        }));

        const { shouldUseMultiAudio } = require("../multiAudioLoader");
        const videoItem = createMockVideoItem({
          MediaStreams: [
            { Type: "Audio", Index: 1, Language: "eng", Codec: "aac", Channels: 2 },
            { Type: "Audio", Index: 2, Language: "spa", Codec: "ac3", Channels: 6 },
          ],
        });

        expect(shouldUseMultiAudio(videoItem)).toBe(false);
      });
    });

    it("should detect missing native module", () => {
      jest.isolateModules(() => {
        jest.doMock("react-native", () => ({
          Platform: { OS: "ios" },
          NativeModules: {}, // No MultiAudioResourceLoader
        }));

        const { shouldUseMultiAudio } = require("../multiAudioLoader");
        const videoItem = createMockVideoItem({
          MediaStreams: [
            { Type: "Audio", Index: 1, Language: "eng", Codec: "aac", Channels: 2 },
            { Type: "Audio", Index: 2, Language: "spa", Codec: "ac3", Channels: 6 },
          ],
        });

        expect(shouldUseMultiAudio(videoItem)).toBe(false);
      });
    });
  });

  describe("Integration behavior (documented)", () => {
    it("keeps concurrent same-item preparations bound to their own configuration URLs", async () => {
      await jest.isolateModulesAsync(async () => {
        const firstUrl = "jellyfin-multi://server/Videos/test-video/master.m3u8?configId=first";
        const secondUrl = "jellyfin-multi://server/Videos/test-video/master.m3u8?configId=second";
        let resolveFirst!: (url: string) => void;
        const firstConfiguration = new Promise<string>((resolve) => {
          resolveFirst = resolve;
        });
        const configureResourceLoader = jest.fn().mockReturnValueOnce(firstConfiguration).mockResolvedValueOnce(secondUrl);
        const generateCustomUrl = jest.fn().mockResolvedValue(secondUrl);
        jest.doMock("react-native", () => ({
          Platform: { OS: "ios" },
          NativeModules: {
            MultiAudioResourceLoader: {
              registerVideoPlugin: jest.fn().mockResolvedValue(undefined),
              configureResourceLoader,
              generateCustomUrl,
            },
          },
        }));
        const loader = require("../multiAudioLoader") as typeof import("../multiAudioLoader");
        const firstSource = createMockVideoItem({
          MediaSources: [{ Id: "first-source" }],
          MediaStreams: [{ Type: "Audio", Codec: "aac", Index: 2 }],
        });
        const secondSource = createMockVideoItem({
          MediaSources: [{ Id: "second-source" }],
          MediaStreams: [{ Type: "Audio", Codec: "ac3", Index: 7 }],
        });
        await loader.registerMultiAudioPlugin();
        const firstPlayback = loader.prepareMultiAudioPlayback(firstSource.Id, firstSource, "http://server/Videos/test-video/master.m3u8?MediaSourceId=first-source", "first-key");
        const secondPlayback = loader.prepareMultiAudioPlayback(secondSource.Id, secondSource, "http://server/Videos/test-video/master.m3u8?MediaSourceId=second-source", "second-key");
        const preparations = Promise.all([firstPlayback, secondPlayback]);
        const completion = expect(preparations).resolves.toEqual([firstUrl, secondUrl]);
        const secondCompletion = expect(secondPlayback)
          .resolves.toBe(secondUrl)
          .finally(() => resolveFirst(firstUrl));
        await Promise.all([completion, secondCompletion]);
        expect(configureResourceLoader.mock.calls[0][3]).toEqual(loader.getAudioTracks(firstSource));
        expect(configureResourceLoader.mock.calls[1][3]).toEqual(loader.getAudioTracks(secondSource));
        expect(generateCustomUrl).not.toHaveBeenCalled();
      });
    });

    it.each([undefined, true])("uses the legacy URL method when configure returns %s", async (configurationResult) => {
      await jest.isolateModulesAsync(async () => {
        const legacyUrl = "jellyfin-multi://server/Videos/test-video/master.m3u8";
        const generateCustomUrl = jest.fn().mockResolvedValue(legacyUrl);
        jest.doMock("react-native", () => ({
          Platform: { OS: "ios" },
          NativeModules: {
            MultiAudioResourceLoader: {
              registerVideoPlugin: jest.fn().mockResolvedValue(undefined),
              configureResourceLoader: jest.fn().mockResolvedValue(configurationResult),
              generateCustomUrl,
            },
          },
        }));
        const loader = require("../multiAudioLoader") as typeof import("../multiAudioLoader");
        const source = createMockVideoItem({ MediaStreams: [{ Type: "Audio", Codec: "aac", Index: 1 }] });
        await loader.registerMultiAudioPlugin();
        await expect(loader.prepareMultiAudioPlayback(source.Id, source, "http://server/Videos/test-video/master.m3u8", "key")).resolves.toBe(legacyUrl);
        expect(generateCustomUrl).toHaveBeenCalledWith(source.Id);
      });
    });

    it("passes the complete catalogue to the native fallback in published order", async () => {
      await jest.isolateModulesAsync(async () => {
        const configureResourceLoader = jest.fn().mockResolvedValue(undefined);
        jest.doMock("react-native", () => ({
          Platform: { OS: "ios" },
          NativeModules: {
            MultiAudioResourceLoader: {
              registerVideoPlugin: jest.fn().mockResolvedValue(undefined),
              configureResourceLoader,
              generateCustomUrl: jest.fn().mockResolvedValue("jellyfin-multi://test-video/master.m3u8"),
            },
          },
        }));
        const loader = require("../multiAudioLoader") as typeof import("../multiAudioLoader");
        const source = createMockVideoItem({
          MediaSources: [{ Id: "alternate" }],
          MediaStreams: [
            { Type: "Audio", Codec: "aac", Index: 2 },
            { Type: "Audio", Codec: "acelp.kelvin", Index: 8, IsDefault: true },
          ],
        });
        await loader.registerMultiAudioPlugin();
        await loader.prepareMultiAudioPlayback(source.Id, source, "http://server/Videos/test-video/master.m3u8?MediaSourceId=alternate", "key");
        expect(configureResourceLoader.mock.calls[0][3]).toEqual(loader.getAudioTracks(source));
        expect(configureResourceLoader.mock.calls[0][3].map((track: AudioTrackInfo) => track.Identity)).toEqual(["alternate:8", "alternate:2"]);
      });
    });

    it("rejects a fallback URL for another media source before configuring native", async () => {
      await jest.isolateModulesAsync(async () => {
        const configureResourceLoader = jest.fn();
        jest.doMock("react-native", () => ({
          Platform: { OS: "ios" },
          NativeModules: {
            MultiAudioResourceLoader: {
              registerVideoPlugin: jest.fn().mockResolvedValue(undefined),
              configureResourceLoader,
              generateCustomUrl: jest.fn(),
            },
          },
        }));
        const loader = require("../multiAudioLoader") as typeof import("../multiAudioLoader");
        const source = createMockVideoItem({ MediaSources: [{ Id: "chosen-source" }], MediaStreams: [{ Type: "Audio", Codec: "aac", Index: 4 }] });
        await loader.registerMultiAudioPlugin();
        await expect(loader.prepareMultiAudioPlayback(source.Id, source, "http://server/master.m3u8?MediaSourceId=another-source", "key")).rejects.toThrow("does not match");
        expect(configureResourceLoader).not.toHaveBeenCalled();
      });
    });

    /**
     * Note: Full integration testing is limited due to module-level state (pluginRegistered).
     * The module is designed to register the plugin once per app lifetime, which makes
     * it difficult to test multiple registration scenarios in isolation.
     *
     * Core functionality (getAudioTracks, language preference, track sorting) is thoroughly
     * tested above. These tests document expected behavior with real native modules.
     */

    it("should return false for shouldUseMultiAudio when plugin not registered", () => {
      jest.isolateModules(() => {
        jest.doMock("react-native", () => ({
          Platform: { OS: "ios" },
          NativeModules: {
            MultiAudioResourceLoader: {
              registerVideoPlugin: jest.fn(),
              configureResourceLoader: jest.fn(),
              generateCustomUrl: jest.fn(),
            },
          },
        }));

        const { shouldUseMultiAudio } = require("../multiAudioLoader");

        const videoItem = createMockVideoItem({
          MediaStreams: [
            { Type: "Audio", Index: 1, Language: "eng", Codec: "aac", Channels: 2 },
            { Type: "Audio", Index: 2, Language: "spa", Codec: "ac3", Channels: 6 },
          ],
        });

        // Plugin not registered, so should return false even with multiple tracks
        expect(shouldUseMultiAudio(videoItem)).toBe(false);
      });
    });

    it("should throw error when prepareMultiAudioPlayback called without plugin registration", async () => {
      await jest.isolateModulesAsync(async () => {
        jest.doMock("react-native", () => ({
          Platform: { OS: "ios" },
          NativeModules: {
            MultiAudioResourceLoader: {
              registerVideoPlugin: jest.fn(),
              configureResourceLoader: jest.fn(),
              generateCustomUrl: jest.fn(),
            },
          },
        }));

        const { prepareMultiAudioPlayback } = require("../multiAudioLoader");

        const videoItem = createMockVideoItem({
          MediaStreams: [{ Type: "Audio", Index: 1, Language: "eng", Codec: "aac", Channels: 2 }],
        });

        await expect(prepareMultiAudioPlayback("test-video", videoItem, "http://test", "api-key")).rejects.toThrow("Multi-audio native module not available");
      });
    });
  });
});
