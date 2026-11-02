/**
 * Media Segments (server 10.10+): typed timeline markers (Intro/Outro/Recap/
 * Preview/Commercial) that server-side plugins attach to items. There is no
 * "Credits" type: Outro is the credits marker.
 *
 * Consumers: the tvOS Up Next content proposal (Outro start = when the
 * proposal appears), the tvOS skip pills, and the automatic skips.
 * Markers only exist on 10.10+ servers running a segments provider plugin. A
 * missing marker only changes timing/affordances, never playback, so every
 * failure path returns empty markers rather than throwing.
 */
import { logger } from "@/utils/logger";
import { fetchWithTimeout } from "./http";
import { API_TIMEOUTS, JELLYFIN_TIME } from "./constants";
import { getAuthHeader, getConfig } from "./session";

interface MediaSegmentDto {
  Id: string;
  ItemId: string;
  Type: string;
  StartTicks: number;
  EndTicks: number;
}

export interface MediaSegmentWindow {
  startSeconds: number;
  endSeconds: number;
}

export interface ItemMediaSegments {
  intro: MediaSegmentWindow | null;
  outro: MediaSegmentWindow | null;
  /** Every Recap segment, in time order. */
  recaps: MediaSegmentWindow[];
  /** Every Preview segment, in time order. */
  previews: MediaSegmentWindow[];
  /** Every Commercial break, in time order. */
  commercials: MediaSegmentWindow[];
}

const NO_SEGMENTS: ItemMediaSegments = { intro: null, outro: null, recaps: [], previews: [], commercials: [] };

/**
 * The item's Intro and Outro windows and its Recap, Preview and Commercial windows, in seconds.
 * Empty when the server has no markers (no segments plugin, pre-10.10 → 404, network failure).
 */
export async function fetchMediaSegments(itemId: string): Promise<ItemMediaSegments> {
  const config = await getConfig();

  if (!config.server || !config.apiKey) {
    return NO_SEGMENTS;
  }

  try {
    const response = await fetchWithTimeout(
      // Repeated keys: ASP.NET binds them to the IEnumerable includeSegmentTypes param.
      `${config.server}/MediaSegments/${itemId}?includeSegmentTypes=Intro&includeSegmentTypes=Outro&includeSegmentTypes=Recap&includeSegmentTypes=Preview&includeSegmentTypes=Commercial`,
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
      // 404 covers pre-10.10 servers; anything else is equally non-fatal.
      return NO_SEGMENTS;
    }

    const data = await response.json();
    const segments = (data.Items ?? []) as MediaSegmentDto[];

    const toWindow = (segment: MediaSegmentDto | undefined): MediaSegmentWindow | null => {
      if (!segment || segment.EndTicks <= segment.StartTicks) return null;
      return {
        startSeconds: segment.StartTicks / JELLYFIN_TIME.TICKS_PER_SECOND,
        endSeconds: segment.EndTicks / JELLYFIN_TIME.TICKS_PER_SECOND,
      };
    };
    const windowsOf = (type: string): MediaSegmentWindow[] => {
      const windows = segments
        .filter((segment) => segment.Type === type)
        .map(toWindow)
        .filter((window): window is MediaSegmentWindow => window !== null)
        .sort((a, b) => a.startSeconds - b.startSeconds);
      // Several server plugins can mark the same span; overlapping windows of a type collapse to their union.
      const merged: MediaSegmentWindow[] = [];
      for (const window of windows) {
        const last = merged[merged.length - 1];
        if (last && window.startSeconds <= last.endSeconds) last.endSeconds = Math.max(last.endSeconds, window.endSeconds);
        else merged.push({ ...window });
      }
      return merged;
    };

    return {
      intro: windowsOf("Intro")[0] ?? null,
      outro: windowsOf("Outro")[0] ?? null,
      recaps: windowsOf("Recap"),
      previews: windowsOf("Preview"),
      commercials: windowsOf("Commercial"),
    };
  } catch (error) {
    logger.debug("Media segments fetch failed; skip/proposal features degrade", { service: "JellyfinAPI", itemId, error: String(error) });
    return NO_SEGMENTS;
  }
}
