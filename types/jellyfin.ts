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
  // Dolby Vision configuration record, as Jellyfin reads it from the container.
  // Profile 8 with BlCompatibility 1 (PQ) or 4 (HLG) is single-layer and plays
  // as plain HDR on any player, which is what SUPPLEMENTAL-CODECS advertises.
  DvProfile?: number;
  DvLevel?: number;
  DvBlSignalCompatibilityId?: number;
  RpuPresentFlag?: number;
  ElPresentFlag?: number;
  BlPresentFlag?: number;
  Level?: number; // Codec level (e.g. 31, 41 for H.264 3.1/4.1; 120 for HEVC 4.0) — half of the CODECS tag
  Profile?: string; // "Main", "High", "Main 10"... — the other half of the CODECS tag
  RealFrameRate?: number; // Frames per second, e.g. 23.976 — the HLS FRAME-RATE attribute
  AverageFrameRate?: number; // Fallback when RealFrameRate is absent
  SampleRate?: number; // Audio sample rate in Hz, for the FLAC bandwidth estimate
  DisplayTitle?: string;
  Title?: string; // The track's own name from the container, when it carries one
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
  Size?: number; // File size in bytes
  Bitrate?: number; // Overall bitrate in bits per second
  MediaStreams?: JellyfinMediaStream[];
}

// Cast/crew entry on an item's People list (Fields=People)
export interface JellyfinPerson {
  Id: string;
  Name: string;
  Role?: string;
  Type?: string; // "Actor", "Director", "Writer"...
  PrimaryImageTag?: string;
}

// One chapter marker on an item's timeline (Fields=Chapters). Jellyfin gives a
// start and nothing else: a chapter's end is the next one's start, and the last
// one's end is the runtime. Name is absent on files whose chapters carry no
// titles, which is most of them; the server sends "Chapter 1" style names only
// when the container had them.
export interface JellyfinChapter {
  StartPositionTicks: number;
  Name?: string;
  ImageTag?: string;
}

export interface JellyfinVideoItem {
  Name: string;
  Id: string;
  RunTimeTicks: number;
  // Only present when the request asked for Fields=Chapters (fetchItemDetails does).
  Chapters?: JellyfinChapter[];
  Type: string;
  Path: string;
  MediaStreams?: JellyfinMediaStream[];
  MediaSources?: JellyfinMediaSource[];
  Overview?: string;
  PremiereDate?: string;
  ProductionYear?: number;
  CommunityRating?: number;
  CriticRating?: number; // 0-100 critic score
  OfficialRating?: string;
  Taglines?: string[];
  Genres?: string[];
  People?: JellyfinPerson[];
  Studios?: JellyfinNamedItem[];
  SeriesName?: string;
  SeriesId?: string; // Set on Episode items; used to queue the rest of the series
  ParentId?: string; // Containing folder — sibling queue source for non-episode items
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  Artists?: string[]; // Audio items: performing artists (default DTO field, not Fields-gated)
  Album?: string; // Audio and Photo items: album name (a Photo's album is its folder)
  AlbumArtist?: string; // Audio items: album-level artist
  // Photo items. Width/Height and DateCreated arrive without a Fields request; the EXIF
  // block is only populated for files that carry it.
  Width?: number;
  Height?: number;
  DateCreated?: string;
  CameraMake?: string;
  CameraModel?: string;
  Software?: string;
  ExposureTime?: number; // Seconds
  FocalLength?: number; // Millimetres
  // APEX values, not an f-number and not seconds — Jellyfin stores EXIF
  // ApertureValue and ShutterSpeedValue raw (Emby.Photos/PhotoProvider.cs).
  Aperture?: number;
  ShutterSpeed?: number;
  IsoSpeedRating?: number;
  Latitude?: number;
  Longitude?: number;
  Altitude?: number; // Metres
  ImageOrientation?: string;
  ImageTags?: {
    Primary?: string;
    Logo?: string;
  };
  BackdropImageTags?: string[];
  PrimaryImageAspectRatio?: number;
  // Top-level container, set alongside MediaSources on playable leaves
  Container?: string;
  OriginalTitle?: string;
  CustomRating?: string;
  ProductionLocations?: string[];
  Tags?: string[];
  // Folder kinds: newest child's add date. `0001-01-01` is the server's "never".
  DateLastMediaAdded?: string;
  SeriesStudio?: string;
  HasLyrics?: boolean;
  UserData?: {
    IsFavorite?: boolean;
    Played?: boolean;
    PlaybackPositionTicks?: number; // Server-side resume position (100ns ticks)
    PlayedPercentage?: number; // 0-100; not always populated — compute from ticks/RunTimeTicks when absent
    PlayCount?: number;
    LastPlayedDate?: string;
    UnplayedItemCount?: number; // Folder kinds only
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
  serverId?: string; // Jellyfin system Id, dedup survives address changes
}

// A saved sign-in on a server. Metadata only: the access token lives at its own
// SecureStore key (accountTokenKey), never in the index.
export interface SavedAccount {
  serverId: string; // Jellyfin system Id
  serverUrl: string; // normalized base url at last use
  serverName: string;
  userId: string;
  userName: string;
  authMethod: "quickconnect" | "password" | "apikey";
  deviceId: string; // Jellyfin allows one token per DeviceId per server, so each account carries its own
  lastUsedAt: number; // ms epoch
}
