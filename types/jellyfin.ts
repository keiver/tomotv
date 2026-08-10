export interface JellyfinMediaStream {
  Codec: string;
  Type: string;
  Width?: number;
  Height?: number;
  BitRate?: number;
  BitDepth?: number; // Bits per color component (8 or 10); gates on-device video transcode
  IsInterlaced?: boolean; // Interlaced video needs the server's deinterlacer
  VideoRange?: string; // "SDR" | "HDR" — coarse range from Jellyfin
  VideoRangeType?: string; // "SDR" | "HDR10" | "HDR10+" | "HLG" | "DOVI"... — drives the HLS VIDEO-RANGE attribute
  Level?: number; // Codec level (e.g. 120, 123 for HEVC 4.0/4.1) — used in the HDR CODECS attribute
  DisplayTitle?: string;
  Index?: number;
  IsExternal?: boolean;
  Language?: string;

  // Audio-specific fields
  Channels?: number; // Audio channel count (e.g., 2 for stereo, 6 for 5.1)
  ChannelLayout?: string; // Audio channel layout (e.g., "5.1", "stereo")

  // Subtitle-specific fields
  IsDefault?: boolean; // Whether this is the default track
  IsForced?: boolean; // Whether this is a forced subtitle track
}

export interface JellyfinMediaSource {
  Id: string;
  Name?: string;
  Path?: string;
  Protocol?: string;
  Container?: string;
  MediaStreams?: JellyfinMediaStream[];
}

export interface JellyfinVideoItem {
  Name: string;
  Id: string;
  RunTimeTicks: number;
  Type: string;
  Path: string;
  MediaStreams?: JellyfinMediaStream[];
  MediaSources?: JellyfinMediaSource[];
  Overview?: string;
  PremiereDate?: string;
  ProductionYear?: number;
  CommunityRating?: number;
  OfficialRating?: string;
  Genres?: string[];
  SeriesName?: string;
  SeriesId?: string; // Set on Episode items; used to queue the rest of the series
  ParentId?: string; // Containing folder — sibling queue source for non-episode items
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  Artists?: string[]; // Audio items: performing artists (default DTO field, not Fields-gated)
  Album?: string; // Audio items: album name
  AlbumArtist?: string; // Audio items: album-level artist
  ImageTags?: {
    Primary?: string;
  };
  PrimaryImageAspectRatio?: number;
  UserData?: {
    IsFavorite?: boolean;
    Played?: boolean;
    PlaybackPositionTicks?: number; // Server-side resume position (100ns ticks)
    PlayedPercentage?: number; // 0-100; not always populated — compute from ticks/RunTimeTicks when absent
  };
}

export interface JellyfinVideosResponse {
  Items: JellyfinVideoItem[];
  TotalRecordCount?: number; // Optional - Jellyfin API doesn't always include this
  StartIndex: number;
}

// Extended item type that includes folder-specific fields
export interface JellyfinItem extends JellyfinVideoItem {
  ChildCount?: number;
  RecursiveItemCount?: number;
  CollectionType?: string;
}

// Minimal Id/Name shape returned by the /Genres and /Artists endpoints
export interface JellyfinNamedItem {
  Id: string;
  Name: string;
}

// Active filter selection for a library view. Any non-default value flattens
// the view to a recursive query (Jellyfin web behavior).
export interface LibraryFilters {
  favorite: boolean;
  played: boolean;
  unplayed: boolean;
  genres: string[];
  artistIds: string[];
  years: number[];
  shuffle: boolean;
}

export const EMPTY_FILTERS: LibraryFilters = {
  favorite: false,
  played: false,
  unplayed: false,
  genres: [],
  artistIds: [],
  years: [],
  shuffle: false,
};

/** Number of active selections (shuffle counts as one). Drives the badge on the Filters button. */
export function countActiveFilters(filters: LibraryFilters): number {
  return Number(filters.favorite) + Number(filters.played) + Number(filters.unplayed) + filters.genres.length + filters.artistIds.length + filters.years.length + Number(filters.shuffle);
}

// Navigation stack entry for breadcrumb
export interface FolderStackEntry {
  id: string;
  name: string;
  parentId?: string;
  type?: "folder" | "playlist"; // Track item type for correct API routing
}

// API response for folder contents
export interface JellyfinFolderResponse {
  Items: JellyfinItem[];
  TotalRecordCount?: number; // Optional - Jellyfin API doesn't always include this
  StartIndex: number;
}

// Authentication response from /Users/AuthenticateByName or /Users/AuthenticateWithQuickConnect
export interface JellyfinAuthResult {
  AccessToken: string;
  User: {
    Id: string;
    Name: string;
  };
}

// Quick Connect initiate/poll response from /QuickConnect/Initiate and /QuickConnect/Connect
export interface QuickConnectResult {
  Code: string;
  Secret: string;
  Authenticated: boolean;
}

// Public server info from /System/Info/Public (no auth required)
export interface JellyfinPublicServerInfo {
  ServerName: string;
  Version: string;
  Id: string;
}

// A locally persisted Jellyfin server destination (no credentials stored).
export interface SavedServer {
  id: string; // normalized url (dedup key)
  name: string; // server display name
  url: string; // normalized base url
  lastConnectedAt: number; // ms epoch, for sort order
}
