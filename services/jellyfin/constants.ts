/**
 * Every literal the Jellyfin layer shares: client identity, SecureStore key names,
 * quality presets, timeouts, and the BaseItemKind allowlists.
 *
 * Leaf module: imports nothing from services/jellyfin/. Anything that needs config or
 * network belongs in session.ts, not here.
 */
import Constants from "expo-constants";
import { Platform } from "react-native";

// Client identification sent to Jellyfin in the MediaBrowser auth header.
// Version is sourced from app.json (single source of truth) so it never drifts.
export const CLIENT_NAME = "TomoTV";
export const CLIENT_VERSION = Constants.expoConfig?.version ?? "0.0.0";
// Platform.OS is "ios" even on Apple TV (react-native-tvos); derive the device
// name from both Platform.OS and Platform.isTV so each platform reports correctly.
function resolveDeviceName(): string {
  if (Platform.OS === "ios") return Platform.isTV ? "Apple TV" : "iOS";
  if (Platform.OS === "android") return Platform.isTV ? "Android TV" : "Android";
  return Platform.OS;
}
export const DEVICE_NAME = resolveDeviceName();

export const STORAGE_KEYS = {
  SERVER_URL: "jellyfin_server_url",
  API_KEY: "jellyfin_api_key",
  USER_ID: "jellyfin_user_id",
  VIDEO_QUALITY: "app_video_quality",
  SUBTITLE_PREFERENCE: "app_subtitle_preference",
  IS_DEMO_MODE: "jellyfin_is_demo_mode",
  DEVICE_ID: "jellyfin_device_id",
  USER_NAME: "jellyfin_user_name",
  AUTH_METHOD: "jellyfin_auth_method",
  SERVER_NAME: "jellyfin_server_name",
  SERVER_ID: "jellyfin_server_id",
  SAVED_SERVERS: "jellyfin_saved_servers",
};

// Old storage keys for migration (deprecated format)
export const OLD_STORAGE_KEYS = {
  SERVER_IP: "jellyfin_server_ip",
  SERVER_PORT: "jellyfin_server_port",
  SERVER_PROTOCOL: "jellyfin_server_protocol",
} as const;

// Demo server credentials (Jellyfin's official public demo server)
// Credentials are fetched dynamically as the demo server resets hourly
export const DEMO_SERVER_STABLE = "https://demo.jellyfin.org/stable";
export const DEMO_USERNAME = "demo";
export const DEMO_PASSWORD = ""; // Empty password
// Display name for the connected card: the server self-reports "Stable Demo"
export const DEMO_SERVER_NAME = "Jellyfin Demo Server";

// Video quality presets (matches settings page)
export interface QualityPreset {
  label: string;
  bitrate: number;
  width?: number;
  height?: number;
  level?: number;
}

// "Original" carries no resolution or level caps, so the server stream-copies
// (remuxes) compatible video instead of re-encoding it. Its bitrate is a
// ceiling no real file reaches, present because the HLS endpoint expects one.
// VideoLevel must stay unset on it: H.264 and HEVC report levels on different
// scales (H.264 5.1 = 51, HEVC 5.1 = 153), and a single scalar cap would
// wrongly block HEVC stream copy.
export const QUALITY_PRESETS: QualityPreset[] = [
  { label: "480p", bitrate: 1500000, width: 854, height: 480, level: 41 },
  { label: "540p", bitrate: 2500000, width: 960, height: 540, level: 41 },
  { label: "720p", bitrate: 4000000, width: 1280, height: 720, level: 41 },
  { label: "1080p", bitrate: 8000000, width: 1920, height: 1080, level: 41 },
  { label: "4K", bitrate: 20000000, width: 3840, height: 2160, level: 51 },
  { label: "Original", bitrate: 120000000 },
];

export const DEFAULT_QUALITY = 5; // Original

// Standardized timeout constants
export const API_TIMEOUTS = {
  SHORT: 5000, // 5s - For very quick operations
  RESOLVE: 8000, // 8s - Racing connect candidates; a cold Jellyfin can be slow on its first request
  QUICK: 10000, // 10s - For simple queries, listing items
  NORMAL: 15000, // 15s - For fetches with moderate data
  EXTENDED: 30000, // 30s - For large data fetches (library items)
} as const;

// Transcoding quality constants
export const TRANSCODING = {
  AUDIO_BITRATE: 192000, // 192kbps AAC
  MAX_AUDIO_CHANNELS: 2, // Stereo output on capped presets
  SURROUND_AUDIO_CHANNELS: 6, // On "Original": lets 5.1 AC3/EAC3 stream-copy
} as const;

// Jellyfin time constants
export const JELLYFIN_TIME = {
  TICKS_PER_SECOND: 10000000, // Jellyfin uses 100-nanosecond intervals (ticks)
} as const;

// Shortest run of characters that may prefix-match a genre or artist name in search.
export const FACET_PREFIX_MIN_CHARS = 3;

/**
 * Jellyfin BaseItemKind allowlists.
 *
 * /Items queries treat IncludeItemTypes as a strict allowlist: any kind not named is
 * silently dropped by the server, which is how Music Videos libraries rendered empty
 * (issue #46). Every supported kind must appear in exactly one of these lists.
 *
 * Deliberately unsupported kinds: Book (needs a reader), live TV kinds and plugin
 * Channels (separate endpoints and features), and metadata kinds (Genre, Person,
 * Studio, Year, internal folders) which never appear as folder children.
 */
export const FOLDER_ITEM_TYPES = ["Folder", "CollectionFolder", "UserView", "Series", "Season", "BoxSet", "MusicAlbum", "MusicArtist", "PhotoAlbum", "Playlist"] as const;
// Streamable through the player; AudioBook rides the existing Audio path
export const PLAYABLE_ITEM_TYPES = ["Movie", "Video", "Episode", "Audio", "MusicVideo", "Trailer", "AudioBook"] as const;
// Flat library list: standalone videos only, Episode/Audio stay excluded
export const STANDALONE_VIDEO_TYPES = ["Movie", "Video", "MusicVideo", "Trailer"] as const;
// Opened in the photo viewer, never queued for playback
export const VIEWABLE_ITEM_TYPES = ["Photo"] as const;

export const BROWSE_ITEM_TYPES = [...FOLDER_ITEM_TYPES, ...PLAYABLE_ITEM_TYPES, ...VIEWABLE_ITEM_TYPES].join(",");

export const FOLDER_TYPE_SET = new Set<string>(FOLDER_ITEM_TYPES);

/**
 * LocationTypes allowed into every list the user browses, queues or searches.
 *
 * The point is to keep out `Virtual`: an item Jellyfin holds with no file behind
 * it, which can never play. It mints them in two ordinary situations:
 *
 * - A Season whose IndexNumber is null (the folder name did not yield a season
 *   number when the item was first created) does not satisfy the episodes'
 *   ParentIndexNumber, so the server adds a numbered, empty Season beside it. The
 *   series then lists both and a four-season show browses as eight folders, four
 *   of which open into nothing. Measured on this repo's dev server:
 *   `LocationType: "Virtual"`, `Path: null`, 0 children.
 * - Missing and unaired episodes, for any profile with "Display missing episodes"
 *   switched on.
 *
 * An ALLOWLIST, not `ExcludeLocationTypes`. That parameter is in the published
 * spec (jellyfin-openapi-stable 12.0.0) but the server does not implement it:
 * measured against 10.11.11 on both `/Users/{userId}/Items` and `/Items?userId=`,
 * `ExcludeLocationTypes=FileSystem` returned all 54 episodes instead of none,
 * while `LocationTypes=Virtual` returned 0 and `LocationTypes=FileSystem`
 * returned 54. Only the include-form is honoured. Do not "simplify" this back.
 *
 * `Remote` rides along because it is genuinely streamable (Live TV, channels).
 * `Offline` is legacy and no current server emits it. Verified across every
 * library on the dev server, recursive and browse shapes: the allowlist drops
 * nothing real.
 *
 * Filtered server-side rather than after the fetch, so paging stays honest: a
 * client-side drop returns short pages while TotalRecordCount still counts rows
 * the user cannot see.
 */
export const INCLUDED_LOCATION_TYPES = "FileSystem,Remote";
