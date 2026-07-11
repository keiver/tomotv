export interface JellyfinMediaStream {
  Codec: string;
  Type: string;
  Width?: number;
  Height?: number;
  BitRate?: number;
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
  SeasonName?: string;
  IndexNumber?: number;
  ParentIndexNumber?: number;
  ImageTags?: {
    Primary?: string;
  };
  PrimaryImageAspectRatio?: number;
  UserData?: {
    IsFavorite?: boolean;
  };
}

export interface JellyfinVideosResponse {
  Items: JellyfinVideoItem[];
  TotalRecordCount?: number; // Optional - Jellyfin API doesn't always include this
  StartIndex: number;
}

// Extended item type that includes folder-specific fields
export interface JellyfinItem extends JellyfinVideoItem {
  ParentId?: string;
  ChildCount?: number;
  RecursiveItemCount?: number;
  CollectionType?: string;
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
