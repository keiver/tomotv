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
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { audioCatalogue } from "@/services/jellyfin/audioTracks";
import { logger } from "@/utils/logger";

const { MultiAudioResourceLoader } = NativeModules;

/**
 * Audio track information for native module
 */
export interface AudioTrackInfo {
  Index: number;
  Identity: string;
  MediaSourceId: string;
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
  return audioCatalogue(videoItem).map((track) => ({
    Index: track.index,
    Identity: track.identity,
    MediaSourceId: track.mediaSourceId,
    Language: track.stream.Language || "und",
    Codec: track.stream.Codec || "unknown",
    Channels: track.stream.Channels || 2,
    DisplayTitle: track.name,
    IsDefault: track.stream.IsDefault ?? false,
  }));
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
  const sourceParameter = [...new URL(baseUrl).searchParams.entries()].find(([name]) => name.toLowerCase() === "mediasourceid")?.[1];
  if (sourceParameter && audioTracks.some((track) => track.MediaSourceId !== sourceParameter)) {
    throw new Error("Audio catalogue does not match the playback URL's media source");
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
    const configuredUrl = await MultiAudioResourceLoader.configureResourceLoader(baseUrl, apiKey, videoId, audioTracks);

    // Generate custom URL
    const customUrl = typeof configuredUrl === "string" ? configuredUrl : await MultiAudioResourceLoader.generateCustomUrl(videoId);

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
