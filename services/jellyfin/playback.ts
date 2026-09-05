/**
 * Telling the server what the player is doing, and reading back what it remembers:
 * the three /Sessions/Playing* reports, the UserData write that bypasses their resume
 * gates, and the Continue Watching / recently-played reads.
 */
import { JellyfinVideoItem } from "@/types/jellyfin";
import { cachedRequest } from "@/services/requestCache";
import { CACHE } from "@/constants/app";
import { logger } from "@/utils/logger";
import { fetchWithTimeout } from "./http";
import { API_TIMEOUTS, JELLYFIN_TIME } from "./constants";
import { invalidateResumeAndItem } from "./cacheKeys";
import { getAuthHeader, getCachedConfig, getConfig, throwRequestError } from "./session";

/**
 * Body shape shared by the three /Sessions/Playing* reports.
 * PlayMethod: "Transcode" for HLS transcoding, "DirectStream" for /stream?Static=true.
 */
export interface PlaybackReportBody {
  ItemId: string;
  MediaSourceId: string;
  PlaySessionId: string;
  PositionTicks: number;
  IsPaused: boolean;
  PlayMethod: "DirectStream" | "Transcode";
  AudioStreamIndex?: number;
  CanSeek: boolean;
}

/**
 * Consecutive transport failures before reporting goes quiet, and for how long.
 *
 * Offline the reports are pure cost: writes are chained, so an unreachable server makes every
 * track transition wait out its timeout in turn. Only a thrown request counts, never a server
 * that answered with an error, and any answer at all reopens the path.
 */
const REPORT_FAILURE_LIMIT = 3;
const REPORT_QUIET_MS = 60_000;
let reportFailures = 0;
let reportQuietUntil = 0;

/** Test seam, and the hook for a deliberate "try the server again now". */
export function resetPlaybackReportBackoff(): void {
  reportFailures = 0;
  reportQuietUntil = 0;
}

/**
 * POST a playback report to the server. Fire-and-forget by design: reporting is
 * best-effort telemetry — a failed ping must never break or delay playback, so this
 * never throws and never retries (a retry would duplicate session events server-side).
 * Success responses are 204 No Content.
 */
async function postPlaybackReport(path: "/Sessions/Playing" | "/Sessions/Playing/Progress" | "/Sessions/Playing/Stopped", body: PlaybackReportBody): Promise<void> {
  // Stopped closes the session on the server. A dropped one leaves it open with no end, so it
  // is attempted even while the path is standing down.
  if (path !== "/Sessions/Playing/Stopped" && Date.now() < reportQuietUntil) return;

  const config = await getConfig();

  if (!config.server || !config.apiKey) {
    logger.warn("Cannot report playback: server not configured", { service: "JellyfinAPI", path });
    return;
  }

  try {
    const response = await fetchWithTimeout(
      `${config.server}${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: getAuthHeader(config.deviceId, config.apiKey),
        },
        body: JSON.stringify(body),
      },
      API_TIMEOUTS.SHORT,
    );

    // The server answered, whatever it said: the link is up.
    reportFailures = 0;
    reportQuietUntil = 0;

    if (!response.ok) {
      logger.warn(`Playback report failed: ${response.status}`, { service: "JellyfinAPI", path, itemId: body.ItemId });
    } else {
      logger.debug("Playback report sent", {
        service: "JellyfinAPI",
        path,
        itemId: body.ItemId,
        positionSeconds: Math.round(body.PositionTicks / JELLYFIN_TIME.TICKS_PER_SECOND),
        isPaused: body.IsPaused,
      });
    }
  } catch (error) {
    reportFailures += 1;
    if (reportFailures >= REPORT_FAILURE_LIMIT) {
      reportQuietUntil = Date.now() + REPORT_QUIET_MS;
      logger.info("Playback reporting paused, the server is unreachable", { service: "JellyfinAPI", quietMs: REPORT_QUIET_MS });
    }
    logger.warn("Playback report error", error, { service: "JellyfinAPI", path, itemId: body.ItemId });
  }
}

/** Report playback started. Registers the session in the server dashboard. */
export async function reportPlaybackStart(body: PlaybackReportBody): Promise<void> {
  await postPlaybackReport("/Sessions/Playing", body);
}

/** Report current position/pause state. The server persists it as the item's resume point. */
export async function reportPlaybackProgress(body: PlaybackReportBody): Promise<void> {
  await postPlaybackReport("/Sessions/Playing/Progress", body);
}

/**
 * Report playback stopped at the final position. The server stores the resume point,
 * auto-marks the item played past its completion threshold, and cleans up any
 * transcode session tied to the PlaySessionId.
 */
export async function reportPlaybackStopped(body: PlaybackReportBody): Promise<void> {
  await postPlaybackReport("/Sessions/Playing/Stopped", body);
  // The server just updated this item's resume point — drop the stale Continue Watching cache.
  // cachedConfig is populated by postPlaybackReport's getConfig() call above.
  invalidateResumeAndItem(getCachedConfig().userId, body.ItemId);
}

/**
 * Write item UserData fields verbatim (POST /UserItems/{itemId}/UserData).
 * Unlike the /Sessions/Playing* reports, this path has NO server-side resume gates
 * (verified in Jellyfin 10.11 UserDataManager: DTO values are copied as-is), so it
 * persists resume positions the Sessions pipeline discards — e.g. items shorter than
 * the server's MinResumeDurationSeconds, which it zeroes and mis-marks Played.
 * Never throws. The result separates a server that did not answer from one that answered
 * 404: only the first is worth holding a position for.
 */
export type UserDataWrite = "ok" | "gone" | "unreachable";

export async function updateUserItemData(itemId: string, data: { PlaybackPositionTicks?: number; Played?: boolean }): Promise<UserDataWrite> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    logger.warn("Cannot update item user data: server not configured", { service: "JellyfinAPI", itemId });
    return "unreachable";
  }

  try {
    const response = await fetchWithTimeout(
      `${config.server}/UserItems/${itemId}/UserData?userId=${config.userId}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          Authorization: getAuthHeader(config.deviceId, config.apiKey),
        },
        body: JSON.stringify(data),
      },
      API_TIMEOUTS.SHORT,
    );

    if (!response.ok) {
      logger.warn(`User data update failed: ${response.status}`, { service: "JellyfinAPI", itemId });
      // 404 is the server saying it has no such item. Retrying that forever is what jammed the
      // offline queue behind one deleted download.
      return response.status === 404 ? "gone" : "unreachable";
    }
    invalidateResumeAndItem(config.userId, itemId, data.PlaybackPositionTicks);
    logger.debug("Resume position persisted", {
      service: "JellyfinAPI",
      itemId,
      positionSeconds: data.PlaybackPositionTicks != null ? Math.round(data.PlaybackPositionTicks / JELLYFIN_TIME.TICKS_PER_SECOND) : undefined,
      played: data.Played,
    });
    return "ok";
  } catch (error) {
    logger.warn("User data update error", error, { service: "JellyfinAPI", itemId });
    return "unreachable";
  }
}

/**
 * Fetch the server-side resume list (items with a saved playback position) for the
 * Continue Watching row. Non-critical display data: never throws. Returns null on
 * failure so callers can tell a transient error from a genuinely empty list.
 */
export async function fetchResumeItems(limit = 20): Promise<JellyfinVideoItem[] | null> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    return null;
  }

  const query = new URLSearchParams({
    Limit: String(limit),
    // ParentId is Fields-gated (like in the browse queries) — the CW binge queue
    // builds from SeriesId ?? ParentId, so without it no queue ever forms.
    Fields: "Path,MediaStreams,ImageTags,PrimaryImageAspectRatio,ParentId",
    EnableUserData: "true",
    MediaTypes: "Video,Audio",
  });

  // Cached (short TTL) and invalidated on playback stop / resume clear. The fetcher THROWS on
  // failure so a transient error is never cached as an empty list; the outer catch returns null.
  const cacheKey = `resume:${config.userId}:${limit}`;
  try {
    return await cachedRequest(
      cacheKey,
      async () => {
        // A row-fetch log without this line means the cache served the row.
        logger.debug("Resume fetch hit network", { service: "JellyfinAPI" });
        try {
          const response = await fetchWithTimeout(
            `${config.server}/UserItems/Resume?userId=${config.userId}&${query.toString()}`,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
            },
            API_TIMEOUTS.QUICK,
          );

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch resume items: ${response.status}`);
          }

          const data = await response.json();
          return (data.Items ?? []) as JellyfinVideoItem[];
        } catch (error) {
          throw error;
        }
      },
      CACHE.RESUME_TTL_MS,
    );
  } catch (error) {
    logger.warn("Failed to fetch resume items", error, { service: "JellyfinAPI" });
    return null;
  }
}

/**
 * Fetch the most recently FINISHED items, newest first — the anchors the Continue Watching
 * row derives its next-up cards from. The resume list can't answer "what was I bingeing":
 * an item leaves it the moment the server marks it played, taking the whole series/folder
 * off the row. Anchoring on played items instead survives that, and covers the low end too
 * (30s into the next episode is below the server's resume floor, so the finished episode is
 * still the newest anchor).
 *
 * Query shape follows appendFlattenFilterParams (verified against 10.11): MediaTypes, never
 * IncludeItemTypes, which zeroes out music/musicvideos/photos/tvshows view-roots on recursive
 * queries. No ParentId — the anchors can come from any library.
 *
 * Non-critical display data: never throws. Returns null on failure so callers can tell a
 * transient error from a genuinely empty list.
 */
export async function fetchRecentlyPlayed(limit = 12): Promise<JellyfinVideoItem[] | null> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    return null;
  }

  const query = new URLSearchParams({
    Limit: String(limit),
    Recursive: "true",
    MediaTypes: "Video,Audio",
    Filters: "IsPlayed",
    SortBy: "DatePlayed",
    SortOrder: "Descending",
    // ParentId is Fields-gated (same as the resume query) and it IS the container key
    // next-up groups by, so without it no anchor can be resolved.
    Fields: "ParentId,ImageTags,PrimaryImageAspectRatio",
    EnableUserData: "true",
  });

  // Same TTL and invalidation as the resume list (invalidateResumeAndItem / invalidatePlayedReads),
  // so one playback stop refreshes both halves of the row. The fetcher THROWS on failure so a
  // transient error is never cached as an empty list; the outer catch returns null.
  const cacheKey = `recentPlayed:${config.userId}:${limit}`;
  try {
    return await cachedRequest(
      cacheKey,
      async () => {
        logger.debug("Recently played fetch hit network", { service: "JellyfinAPI" });
        try {
          const response = await fetchWithTimeout(
            `${config.server}/Items?userId=${config.userId}&${query.toString()}`,
            {
              method: "GET",
              headers: {
                Accept: "application/json",
                Authorization: getAuthHeader(config.deviceId, config.apiKey),
              },
            },
            API_TIMEOUTS.QUICK,
          );

          if (!response.ok) {
            throwRequestError(response, `Failed to fetch recently played items: ${response.status}`);
          }

          const data = await response.json();
          return (data.Items ?? []) as JellyfinVideoItem[];
        } catch (error) {
          throw error;
        }
      },
      CACHE.RESUME_TTL_MS,
    );
  } catch (error) {
    logger.warn("Failed to fetch recently played items", error, { service: "JellyfinAPI" });
    return null;
  }
}

/**
 * Clear an item's resume position ("Remove from Continue Watching") by marking it
 * unplayed — DELETE /PlayedItems resets both Played and PlaybackPositionTicks without
 * marking the item watched (which would pollute the Played filter).
 */
export async function clearResumePosition(itemId: string): Promise<void> {
  const config = await getConfig();

  if (!config.server || !config.apiKey || !config.userId) {
    throw new Error("Jellyfin server not configured.");
  }

  const response = await fetchWithTimeout(
    `${config.server}/UserPlayedItems/${itemId}?userId=${config.userId}`,
    {
      method: "DELETE",
      headers: {
        Accept: "application/json",
        Authorization: getAuthHeader(config.deviceId, config.apiKey),
      },
    },
    API_TIMEOUTS.NORMAL,
  );

  if (!response.ok) {
    throwRequestError(response, `Failed to clear resume position: ${response.status}`);
  }

  // Item removed from Continue Watching — drop the stale resume list and item detail.
  invalidateResumeAndItem(config.userId, itemId, 0);
}
