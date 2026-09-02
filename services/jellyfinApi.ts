/**
 * The Jellyfin API surface.
 *
 * This file is a barrel: the implementation lives in the domain modules under
 * ./jellyfin/, and everything they expose publicly is re-exported here. Import from
 * "@/services/jellyfinApi" and nothing else — the submodule paths are internal.
 *
 * That rule is load-bearing, not stylistic. A dozen test files mock this module by
 * specifier (`jest.mock("@/services/jellyfinApi")`). A consumer that imported
 * "./jellyfin/search" directly would slip past its own test's mock and hit the network
 * while still reporting green.
 *
 * Re-exports are listed explicitly rather than `export *` so the public API is greppable
 * in one place and the compiler catches a symbol dropped during a move.
 *
 * session is first on purpose: it owns the credential cache and kicks off the
 * module-load config warm-up, so its evaluation should not depend on import ordering
 * elsewhere in this list.
 */
export {
  didConfigReadFail,
  generateDeviceId,
  generatePlaySessionId,
  getAuthHeader,
  getConfig,
  isAuthenticated,
  isConfigReady,
  refreshConfig,
  setSavedConnectionStatus,
  signOut,
  validateAccessToken,
  waitForConfig,
} from "./jellyfin/session";

export { activateAccount, getAccountsForServer, getSavedAccounts, relocateAccounts, removeAccount, removeSavedServerAndAccounts, upsertAccount } from "./jellyfin/accounts";
export type { ActivateAccountResult } from "./jellyfin/accounts";

export { DEMO_SERVER_STABLE, DEMO_USERNAME, JELLYFIN_TIME } from "./jellyfin/constants";
export { notifyResumeChange, notifyServerRecovered, subscribeAuthChange, subscribeFavoriteChange, subscribePlayedChange, subscribeResumeChange } from "./jellyfin/events";
export { audioNeedsRewrap, formatDuration, isAudioItem, isAudioOnly, isCodecSupported, needsTranscoding } from "./jellyfin/media";
export { fetchMediaSegments } from "./jellyfin/mediaSegments";
export type { ItemMediaSegments, MediaSegmentWindow } from "./jellyfin/mediaSegments";

export {
  adoptRecoveredServerUrl,
  buildServerUrlCandidates,
  checkServerInfo,
  evaluateSavedConnection,
  getSavedConnectionInfo,
  getSavedServers,
  getStoredServerId,
  ProbeError,
  ProbeFailureReason,
  removeSavedServer,
  renameSavedServer,
  resolveServerConnection,
  restoreLastConnection,
  upsertSavedServer,
} from "./jellyfin/connection";
export {
  authenticateByName,
  authenticateWithQuickConnect,
  checkQuickConnectEnabled,
  getStoredAuthMethod,
  getStoredServerName,
  getStoredUserName,
  initiateQuickConnect,
  pollQuickConnect,
  saveAuthResult,
} from "./jellyfin/auth";
export { connectToDemoServer, disconnectFromDemo, isDemoMode } from "./jellyfin/demo";

export {
  fetchFavoriteIds,
  fetchFavoriteItems,
  fetchFilteredVideos,
  fetchFolderContents,
  fetchFolderMediaKinds,
  fetchFolderPhotos,
  FolderMediaKinds,
  fetchUserViews,
  fetchViewItemCount,
  isFolder,
  isPhoto,
} from "./jellyfin/library";
export {
  fetchAllPlaylistItems,
  fetchItemDetails,
  fetchItemFolderPath,
  fetchItemsByIds,
  fetchLatestItems,
  fetchLibraryName,
  fetchLibraryVideos,
  fetchPlaylistContents,
  fetchRecursiveDownloadables,
  fetchRecursivePhotos,
  fetchRecursiveVideos,
  fetchVideoDetails,
} from "./jellyfin/items";
export { fetchLibraryArtists, fetchLibraryGenres, fetchLibraryYears } from "./jellyfin/facets";
export { searchVideos } from "./jellyfin/search";

export { markItemPlayed, setVideoFavorite, setVideoPlayed } from "./jellyfin/userData";
export {
  clearResumePosition,
  fetchRecentlyPlayed,
  fetchResumeItems,
  PlaybackReportBody,
  reportPlaybackProgress,
  reportPlaybackStart,
  reportPlaybackStopped,
  updateUserItemData,
} from "./jellyfin/playback";

export { getTranscodingStreamUrl, getVideoStreamUrl } from "./jellyfin/streamUrls";
export { getBackdropBlurUrl, getBackdropUrl, getChapterImageUrl, getFolderThumbnailUrl, getLogoUrl, getPersonImageUrl, getPhotoFileUrl, getPhotoUrl, getPosterUrl, hasPoster } from "./jellyfin/images";
export { getBurnInSubtitleStream, getSubtitleUrl, getTextSubtitleStreams, isImageBasedSubtitleCodec } from "./jellyfin/subtitles";
