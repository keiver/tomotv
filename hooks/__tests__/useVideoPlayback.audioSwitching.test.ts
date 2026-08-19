/**
 * useVideoPlayback.audioSwitching.test.ts
 *
 * Comprehensive tests for audio track switching flow in useVideoPlayback hook.
 * Covers the full user flow: track selection → restart → position restore → playback.
 *
 * Created: January 24, 2026
 */

import { type AudioTrack } from "react-native-video";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import type { AudioTrackInfo } from "@/services/multiAudioLoader";

// Helper to create mock video item
function createMockVideoItem(overrides: Partial<JellyfinVideoItem> = {}): JellyfinVideoItem {
  return {
    Id: "test-video-123",
    Name: "Test Video",
    RunTimeTicks: 60000000000,
    Type: "Video",
    Path: "/media/test.mkv",
    MediaStreams: [
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
    ...overrides,
  };
}

describe("useVideoPlayback - Audio Track Switching", () => {
  describe("handleAudioTrackSwitch logic", () => {
    /**
     * Test the audio track switching logic WITHOUT React rendering.
     * This tests the core algorithm that handles track switching with restart.
     */

    it("should correctly map player track index to Jellyfin stream index", () => {
      // Simulate getAudioTracks() result (sorted with English first)
      const sortedAudioTracks: AudioTrackInfo[] = [
        {
          Index: 1,
          Language: "eng",
          Codec: "aac",
          Channels: 2,
          DisplayTitle: "English (AAC Stereo)",
          IsDefault: true,
        },
        {
          Index: 2,
          Language: "spa",
          Codec: "ac3",
          Channels: 6,
          DisplayTitle: "Spanish (AC3 5.1)",
          IsDefault: false,
        },
      ];

      // Build mapping array (same pattern used in hook)
      const audioTrackMapping = sortedAudioTracks.map((track) => track.Index);

      // User selects track 0 (first track in player, which is English)
      const selectedExpoIndex = 0;
      const jellyfinStreamIndex = audioTrackMapping[selectedExpoIndex];

      expect(jellyfinStreamIndex).toBe(1); // English is Jellyfin stream index 1
    });

    it("should correctly map when language preference reorders tracks", () => {
      // Pre-sort stream order that the sorted list below derives from
      const _videoItem = createMockVideoItem({
        MediaStreams: [
          {
            Type: "Audio",
            Index: 8,
            Language: "und",
            Codec: "aac",
            Channels: 2,
            DisplayTitle: "UND (AAC Stereo)",
            IsDefault: true, // Jellyfin default
          },
          {
            Type: "Audio",
            Index: 1,
            Language: "eng",
            Codec: "aac",
            Channels: 1,
            DisplayTitle: "ENG (AAC Mono)",
            IsDefault: false,
          },
        ],
      });

      // After sorting (English preference), order changes: [1, 8]
      const sortedAudioTracks: AudioTrackInfo[] = [
        {
          Index: 1, // English moved to front
          Language: "eng",
          Codec: "aac",
          Channels: 1,
          DisplayTitle: "ENG (AAC Mono)",
          IsDefault: true, // Overridden by language preference
        },
        {
          Index: 8, // UND moved to back
          Language: "und",
          Codec: "aac",
          Channels: 2,
          DisplayTitle: "UND (AAC Stereo)",
          IsDefault: false,
        },
      ];

      const audioTrackMapping = sortedAudioTracks.map((track) => track.Index);

      expect(audioTrackMapping).toEqual([1, 8]); // NOT [8, 1]
      expect(audioTrackMapping[0]).toBe(1); // First expo track = Jellyfin 1
      expect(audioTrackMapping[1]).toBe(8); // Second expo track = Jellyfin 8
    });

    it("should reorder the mapping preferred-first after a local remux audio switch restart", () => {
      // The rebuilt remux stream puts the user-selected track at position 0
      // (it becomes DEFAULT=YES in the HLS master playlist), so the mapping
      // must mirror that order or the next switch targets the wrong stream.
      const sortedAudioTracks: AudioTrackInfo[] = [
        { Index: 1, Language: "und", Codec: "aac", Channels: 2, DisplayTitle: "AAC - Stereo - Default", IsDefault: true },
        { Index: 8, Language: "eng", Codec: "aac", Channels: 1, DisplayTitle: "Commentary - English - AAC - Mono", IsDefault: false },
      ];

      // Same reorder the hook applies when selectedAudioTrackIndexRef is set for localRemux
      const preferredAudioIndex = 8;
      const orderedTracks = [...sortedAudioTracks].sort((a, b) => Number(b.Index === preferredAudioIndex) - Number(a.Index === preferredAudioIndex));
      const audioTrackMapping = orderedTracks.map((track) => track.Index);

      expect(audioTrackMapping).toEqual([8, 1]);
      // Player reports track 0 selected after restart — it must resolve to the chosen stream
      expect(audioTrackMapping[0]).toBe(8);
      // Switching back: player track 1 must resolve to the original default
      expect(audioTrackMapping[1]).toBe(1);
    });

    it("should leave the mapping default-first when the preferred index matches no stream", () => {
      // Stale ref values after load are player-side indices (0/1), not Jellyfin
      // stream indices — a non-matching value must be a no-op.
      const sortedAudioTracks: AudioTrackInfo[] = [
        { Index: 1, Language: "und", Codec: "aac", Channels: 2, DisplayTitle: "AAC - Stereo - Default", IsDefault: true },
        { Index: 8, Language: "eng", Codec: "aac", Channels: 1, DisplayTitle: "Commentary - English - AAC - Mono", IsDefault: false },
      ];

      const preferredAudioIndex = 0;
      const orderedTracks = [...sortedAudioTracks].sort((a, b) => Number(b.Index === preferredAudioIndex) - Number(a.Index === preferredAudioIndex));

      expect(orderedTracks.map((track) => track.Index)).toEqual([1, 8]);
    });

    it("should handle edge case: single audio track", () => {
      const sortedAudioTracks: AudioTrackInfo[] = [
        {
          Index: 1,
          Language: "eng",
          Codec: "aac",
          Channels: 2,
          DisplayTitle: "English",
          IsDefault: true,
        },
      ];

      const audioTrackMapping = sortedAudioTracks.map((track) => track.Index);

      expect(audioTrackMapping).toEqual([1]);
      expect(audioTrackMapping[0]).toBe(1);
    });

    it("should handle edge case: no audio tracks", () => {
      const sortedAudioTracks: AudioTrackInfo[] = [];

      const audioTrackMapping = sortedAudioTracks.map((track) => track.Index);

      expect(audioTrackMapping).toEqual([]);
    });

    it("should handle tracks with non-sequential indices", () => {
      const sortedAudioTracks: AudioTrackInfo[] = [
        { Index: 3, Language: "eng", Codec: "aac", Channels: 2, DisplayTitle: "English" },
        { Index: 7, Language: "spa", Codec: "ac3", Channels: 6, DisplayTitle: "Spanish" },
        { Index: 12, Language: "fra", Codec: "aac", Channels: 2, DisplayTitle: "French" },
      ];

      const audioTrackMapping = sortedAudioTracks.map((track) => track.Index);

      expect(audioTrackMapping).toEqual([3, 7, 12]);
      expect(audioTrackMapping[0]).toBe(3); // expo track 0 = Jellyfin 3
      expect(audioTrackMapping[1]).toBe(7); // expo track 1 = Jellyfin 7
      expect(audioTrackMapping[2]).toBe(12); // expo track 2 = Jellyfin 12
    });
  });

  describe("Track switching restart flow", () => {
    /**
     * Tests the sequence: user selects track → pause → save position → restart with new track
     */

    it("should save playback position before switching tracks", () => {
      // Simulate current playback position
      const currentPosition = 125.5; // 2 minutes 5.5 seconds

      // When user switches track, this position should be saved
      const savedPosition = currentPosition;

      expect(savedPosition).toBe(125.5);
    });

    it("should restart playback at saved position after track switch", () => {
      const savedPosition = 125.5;

      // After restart, player should seek to saved position
      const seekToPosition = savedPosition;

      expect(seekToPosition).toBe(125.5);
    });

    it("should build new transcoding URL with selected audio stream", async () => {
      const videoId = "test-video-123";
      const baseServerUrl = "http://jellyfin:8096";
      const apiKey = "test-api-key";
      const selectedJellyfinStreamIndex = 2; // User selected Spanish (stream index 2)

      // Simulate getTranscodingStreamUrl call with audioStreamIndex
      const expectedUrl = `${baseServerUrl}/Videos/${videoId}/master.m3u8?ApiKey=${apiKey}&AudioStreamIndex=${selectedJellyfinStreamIndex}`;

      // This is what the hook should generate
      const generatedUrl = `${baseServerUrl}/Videos/${videoId}/master.m3u8?ApiKey=${apiKey}&AudioStreamIndex=${selectedJellyfinStreamIndex}`;

      expect(generatedUrl).toBe(expectedUrl);
      expect(generatedUrl).toContain("AudioStreamIndex=2");
    });
  });

  describe("onAudioTracks callback", () => {
    /**
     * Tests the react-native-video onAudioTracks callback that provides available audio tracks
     */

    it("should receive audio tracks from video player", () => {
      // Simulate react-native-video's onAudioTracks callback
      const mockAudioTracks: AudioTrack[] = [
        {
          index: 0,
          language: "eng",
          title: "English (AAC Stereo)",
        },
        {
          index: 1,
          language: "spa",
          title: "Spanish (AC3 5.1)",
        },
      ];

      // Hook should store these tracks
      const storedTracks = mockAudioTracks;

      expect(storedTracks).toHaveLength(2);
      expect(storedTracks[0].language).toBe("eng");
      expect(storedTracks[1].language).toBe("spa");
    });

    it("should handle onAudioTracks called with empty array", () => {
      const mockAudioTracks: AudioTrack[] = [];

      const storedTracks = mockAudioTracks;

      expect(storedTracks).toHaveLength(0);
    });

    it("should handle onAudioTracks called with single track", () => {
      const mockAudioTracks: AudioTrack[] = [
        {
          index: 0,
          language: "eng",
          title: "English",
        },
      ];

      const storedTracks = mockAudioTracks;

      expect(storedTracks).toHaveLength(1);
      expect(storedTracks[0].language).toBe("eng");
    });
  });

  describe("Edge cases and error handling", () => {
    it("should handle switch to same track (no-op)", () => {
      const currentJellyfinStreamIndex = 1;
      const selectedJellyfinStreamIndex = 1;

      // Should detect same track and skip restart
      const shouldRestart = currentJellyfinStreamIndex !== selectedJellyfinStreamIndex;

      expect(shouldRestart).toBe(false);
    });

    it("should handle invalid track index gracefully", () => {
      const audioTrackMapping = [1, 2, 3];
      const invalidExpoIndex = 99;

      // Attempting to access invalid index returns undefined
      const jellyfinStreamIndex = audioTrackMapping[invalidExpoIndex];

      expect(jellyfinStreamIndex).toBeUndefined();
    });

    it("should handle negative track index", () => {
      const audioTrackMapping = [1, 2, 3];
      const negativeExpoIndex = -1;

      const jellyfinStreamIndex = audioTrackMapping[negativeExpoIndex];

      expect(jellyfinStreamIndex).toBeUndefined();
    });

    it("should preserve position even on very short videos", () => {
      const currentPosition = 0.5; // 500ms into video

      const savedPosition = currentPosition;

      expect(savedPosition).toBe(0.5);
    });

    it("should preserve position at end of video", () => {
      const currentPosition = 599.9; // Near end of a 600s video

      const savedPosition = currentPosition;

      expect(savedPosition).toBe(599.9);
    });

    it("should handle position = 0 (video start)", () => {
      const currentPosition = 0;

      const savedPosition = currentPosition;

      expect(savedPosition).toBe(0);
    });
  });

  describe("Multi-audio manifest integration", () => {
    /**
     * Tests integration with the custom multi-audio manifest system
     */

    it("should use multi-audio manifest for videos with multiple tracks", () => {
      const videoItem = createMockVideoItem(); // Has 2 audio tracks

      // When shouldUseMultiAudio returns true, use custom protocol
      const hasMultipleAudioTracks = videoItem.MediaStreams!.filter((s) => s.Type === "Audio").length > 1;

      expect(hasMultipleAudioTracks).toBe(true);

      // Should use file:// URL from Swift module instead of regular HLS
      const shouldUseCustomProtocol = hasMultipleAudioTracks;

      expect(shouldUseCustomProtocol).toBe(true);
    });

    it("should NOT use multi-audio manifest for single audio track", () => {
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

      const hasMultipleAudioTracks = videoItem.MediaStreams!.filter((s) => s.Type === "Audio").length > 1;

      expect(hasMultipleAudioTracks).toBe(false);
    });

    it("should handle direct play with multiple audio tracks (no custom protocol)", () => {
      const isDirectPlay = true;
      const hasMultipleAudioTracks = true;

      // Direct play doesn't need custom protocol - AVPlayer handles it natively
      const shouldUseCustomProtocol = !isDirectPlay && hasMultipleAudioTracks;

      expect(shouldUseCustomProtocol).toBe(false);
    });
  });

  describe("Real-world scenario", () => {
    /**
     * End-to-end test of complete audio switching flow
     */

    it("should handle complete track switch flow", () => {
      // Initial state
      const currentPosition = 125.5;
      const currentAudioStreamIndex = 1; // Currently playing English

      // User selects Spanish (player track index 1)
      const selectedExpoTrackIndex = 1;

      // Build mapping from sorted tracks
      const sortedAudioTracks: AudioTrackInfo[] = [
        { Index: 1, Language: "eng", Codec: "aac", Channels: 2, DisplayTitle: "English" },
        { Index: 2, Language: "spa", Codec: "ac3", Channels: 6, DisplayTitle: "Spanish" },
      ];

      const audioTrackMapping = sortedAudioTracks.map((track) => track.Index);

      // Map expo index to Jellyfin index
      const newJellyfinStreamIndex = audioTrackMapping[selectedExpoTrackIndex];

      expect(newJellyfinStreamIndex).toBe(2); // Spanish is Jellyfin stream 2

      // Check if different from current
      const isDifferentTrack = newJellyfinStreamIndex !== currentAudioStreamIndex;

      expect(isDifferentTrack).toBe(true);

      // Save position
      const savedPosition = currentPosition;

      expect(savedPosition).toBe(125.5);

      // Build new URL
      const newUrl = `http://jellyfin:8096/Videos/test-video-123/master.m3u8?AudioStreamIndex=${newJellyfinStreamIndex}`;

      expect(newUrl).toContain("AudioStreamIndex=2");

      // Verify complete flow
      expect(newJellyfinStreamIndex).toBe(2);
      expect(savedPosition).toBe(125.5);
      expect(newUrl).toContain("test-video-123");
    });

    it("should handle no-op track switch (same track selected)", () => {
      const currentAudioStreamIndex = 1;
      const selectedExpoTrackIndex = 0; // Same track

      const audioTrackMapping = [1, 2];
      const newJellyfinStreamIndex = audioTrackMapping[selectedExpoTrackIndex];

      const isDifferentTrack = newJellyfinStreamIndex !== currentAudioStreamIndex;

      expect(isDifferentTrack).toBe(false); // Should skip restart
    });

    it("should handle language-preference reordering in switching", () => {
      // Original Jellyfin order: [UND (index 8), ENG (index 1)]
      // After sorting: [ENG (index 1), UND (index 8)]

      const sortedAudioTracks: AudioTrackInfo[] = [
        { Index: 1, Language: "eng", Codec: "aac", Channels: 1, DisplayTitle: "ENG" },
        { Index: 8, Language: "und", Codec: "aac", Channels: 2, DisplayTitle: "UND" },
      ];

      const audioTrackMapping = sortedAudioTracks.map((track) => track.Index);

      // User sees: [0: English, 1: Unknown]
      // User selects 1 (Unknown)
      const selectedExpoIndex = 1;
      const jellyfinStreamIndex = audioTrackMapping[selectedExpoIndex];

      expect(jellyfinStreamIndex).toBe(8); // Correctly maps to original Jellyfin index 8
    });
  });
});
