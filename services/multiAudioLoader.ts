/**
 * multiAudioLoader.ts
 *
 * Service for preparing multi-audio track playback with custom HLS manifest generation.
 * This enables seamless audio track switching during transcoding - TomoTV's killer feature!
 *
 * How it works:
 * 1. Detects videos with multiple audio tracks
 * 2. Configures native Swift resource loader with track metadata
 * 3. Generates custom protocol URL (jellyfin-multi://...)
 * 4. react-native-video plugin (patched) attaches resource loader to intercept requests
 * 5. Native module generates multivariant HLS manifest on-the-fly
 * 6. AVPlayer discovers all audio tracks and enables seamless switching
 *
 * Created: January 23, 2026
 * Updated: January 24, 2026 - Added patch-package for react-native-video custom protocol support
 */

import { NativeModules, Platform } from "react-native";
import type { JellyfinVideoItem, JellyfinMediaStream } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

const { MultiAudioResourceLoader } = NativeModules;

/**
 * Audio track information for native module
 */
export interface AudioTrackInfo {
  Index: number;
  Language: string;
  Codec: string;
  Channels: number;
  DisplayTitle: string;
  IsDefault?: boolean;
}

// Track if plugin has been registered
let pluginRegistered = false;

/**
 * Register the plugin with react-native-video
 * Required for custom URL interception (http://jellyfin-multi.internal/...)
 */
export async function registerMultiAudioPlugin(): Promise<void> {
  // Only register on iOS/tvOS
  if (Platform.OS !== "ios") {
    logger.debug("Skipping plugin registration: not iOS platform", {
      service: "MultiAudioLoader",
      platform: Platform.OS,
    });
    return;
  }

  // Check if native module exists
  if (!MultiAudioResourceLoader || typeof MultiAudioResourceLoader.registerVideoPlugin !== "function") {
    logger.warn("Multi-audio native module not available", {
      service: "MultiAudioLoader",
      hasModule: !!MultiAudioResourceLoader,
    });
    return;
  }

  // Only register once
  if (pluginRegistered) {
    logger.debug("Plugin already registered", {
      service: "MultiAudioLoader",
    });
    return;
  }

  try {
    logger.info("Registering multi-audio video plugin", {
      service: "MultiAudioLoader",
    });

    // Register plugin with react-native-video
    await MultiAudioResourceLoader.registerVideoPlugin();

    pluginRegistered = true;

    logger.info("Multi-audio plugin registered successfully", {
      service: "MultiAudioLoader",
    });
  } catch (error) {
    logger.error("Failed to register multi-audio plugin", {
      service: "MultiAudioLoader",
      error,
    });
    throw error;
  }
}

/**
 * Check if multi-audio native module is available
 * Only available on iOS/tvOS
 */
export function isMultiAudioAvailable(): boolean {
  // Check platform - multi-audio only available on iOS/tvOS
  if (Platform.OS !== "ios") {
    logger.debug("Multi-audio not available: not iOS platform", {
      service: "MultiAudioLoader",
      platform: Platform.OS,
    });
    return false;
  }

  // Verify native module exists and plugin is registered
  const available = MultiAudioResourceLoader !== null && MultiAudioResourceLoader !== undefined && pluginRegistered;

  logger.info("Multi-audio module availability check", {
    service: "MultiAudioLoader",
    available,
    pluginRegistered,
    hasModule: !!MultiAudioResourceLoader,
  });

  return available;
}

/**
 * Extract audio track information from video metadata
 */
export function getAudioTracks(videoItem: JellyfinVideoItem): AudioTrackInfo[] {
  // MediaStreams can be at the top level OR in MediaSources[0].MediaStreams
  let mediaStreams = videoItem.MediaStreams;

  // Fallback to MediaSources if top-level MediaStreams is empty
  if ((!mediaStreams || mediaStreams.length === 0) && videoItem.MediaSources && videoItem.MediaSources.length > 0) {
    mediaStreams = videoItem.MediaSources[0].MediaStreams;
    logger.debug("Top-level MediaStreams was empty, reading MediaSources[0]", {
      service: "MultiAudioLoader",
      streamCount: mediaStreams?.length || 0,
    });
  }

  if (!mediaStreams || mediaStreams.length === 0) {
    logger.warn("No MediaStreams found in video metadata", {
      service: "MultiAudioLoader",
      videoId: videoItem.Id,
      hasTopLevelStreams: !!videoItem.MediaStreams,
      topLevelCount: videoItem.MediaStreams?.length || 0,
      hasMediaSources: !!videoItem.MediaSources,
      mediaSourceCount: videoItem.MediaSources?.length || 0,
    });
    return [];
  }

  const audioStreams = mediaStreams.filter((stream: JellyfinMediaStream) => stream.Type === "Audio");

  const tracks = audioStreams.map((stream: JellyfinMediaStream) => ({
    Index: stream.Index ?? 0,
    Language: stream.Language || "und",
    Codec: stream.Codec || "unknown",
    Channels: stream.Channels || 2,
    DisplayTitle: stream.DisplayTitle || `${stream.Language || "Unknown"} (${stream.Codec || "Unknown"})`,
    IsDefault: stream.IsDefault ?? false,
  }));

  // Jellyfin's IsDefault flag is the server's own choice of track; keep it first.
  return tracks.sort((a, b) => {
    if (a.IsDefault && !b.IsDefault) return -1;
    if (!a.IsDefault && b.IsDefault) return 1;
    return 0;
  });
}

/**
 * Prepare multi-audio playback for a video with multiple audio tracks
 *
 * @param videoId - Jellyfin item ID
 * @param videoItem - Video metadata from Jellyfin
 * @param baseUrl - HLS transcoding base URL (from getTranscodingStreamUrl)
 * @param apiKey - Jellyfin API key
 * @returns Custom protocol URL for multi-audio playback (jellyfin-multi://...)
 * @throws Error if native module is not available or configuration fails
 */
export async function prepareMultiAudioPlayback(videoId: string, videoItem: JellyfinVideoItem, baseUrl: string, apiKey: string): Promise<string> {
  // Verify native module is available
  if (!isMultiAudioAvailable()) {
    throw new Error("Multi-audio native module not available on this platform");
  }

  // Extract audio tracks
  const audioTracks = getAudioTracks(videoItem);

  if (audioTracks.length === 0) {
    throw new Error("No audio tracks found in video metadata");
  }

  logger.info("Preparing multi-audio playback", {
    service: "MultiAudioLoader",
    videoId,
    audioTrackCount: audioTracks.length,
    tracks: audioTracks.map((t) => ({
      language: t.Language,
      codec: t.Codec,
      channels: t.Channels,
    })),
  });

  try {
    // Configure resource loader with track info
    await MultiAudioResourceLoader.configureResourceLoader(baseUrl, apiKey, videoId, audioTracks);

    // Generate custom URL
    const customUrl = await MultiAudioResourceLoader.generateCustomUrl(videoId);

    logger.info("Multi-audio manifest file URL generated", {
      service: "MultiAudioLoader",
      videoId,
      fileUrl: customUrl,
      urlType: customUrl.startsWith("file://") ? "local_file" : "unknown",
    });

    return customUrl;
  } catch (error) {
    logger.error("Failed to prepare multi-audio playback", {
      service: "MultiAudioLoader",
      videoId,
      error,
    });
    throw error;
  }
}

/**
 * Check if a video should use multi-audio playback
 *
 * @param videoItem - Video metadata
 * @returns true if video has multiple audio tracks and needs transcoding
 */
export function shouldUseMultiAudio(videoItem: JellyfinVideoItem): boolean {
  // Re-enabled to get all audio tracks into HLS manifest
  // The native module generates manifests with all audio tracks
  // Audio switching will use restart+auto-seek approach (handled in useVideoPlayback)
  if (!isMultiAudioAvailable()) {
    logger.debug("Multi-audio not available, skipping", {
      service: "MultiAudioLoader",
    });
    return false;
  }

  const audioTracks = getAudioTracks(videoItem);

  logger.info("Checking if video should use multi-audio", {
    service: "MultiAudioLoader",
    videoId: videoItem.Id,
    audioTrackCount: audioTracks.length,
    tracks: audioTracks,
  });

  return audioTracks.length > 1;
}
