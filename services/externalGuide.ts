/**
 * externalGuide.ts
 *
 * Guide programmes for channels the server has none for, from an XMLTV the viewer names (the
 * iptv-org/epg output format: channel ids are tvg-id bases). The guide streams into the native
 * store once per window and is queried per page.
 */
import { closeGuide, guideProgrammes, isLiveSourcesAvailable, loadGuide } from "@/services/liveSources";
import type { JellyfinProgram } from "@/types/jellyfin";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";
import { logger } from "@/utils/logger";

/** One load covers this far past the requested end, so window extensions rarely reload. */
const WINDOW_SLACK_MS = 24 * 60 * 60 * 1000;

interface OpenGuide {
  url: string;
  token: string;
  from: number;
  to: number;
}

let open: OpenGuide | null = null;
let opening: Promise<OpenGuide> | null = null;

/** A tvg-id and the base its guide names: `A.us@SD` is listed as `A.us` in iptv-org/epg output. */
function candidates(tvgId: string): string[] {
  const base = tvgId.split("@")[0];
  return base === tvgId ? [tvgId] : [tvgId, base];
}

async function ensureOpen(url: string, windowMs: { from: number; to: number }): Promise<OpenGuide> {
  if (open && open.url === url && open.from <= windowMs.from && open.to >= windowMs.to) return open;
  if (opening) {
    const pending = await opening.catch(() => null);
    if (pending && pending.url === url && pending.from <= windowMs.from && pending.to >= windowMs.to) return pending;
  }
  const target = { url, from: windowMs.from, to: windowMs.to + WINDOW_SLACK_MS };
  opening = (async () => {
    if (open) {
      closeGuide(open.token).catch(() => {});
      open = null;
    }
    const token = await loadGuide(url, { from: target.from, to: target.to });
    open = { url, token, from: target.from, to: target.to };
    return open;
  })();
  try {
    return await opening;
  } finally {
    opening = null;
  }
}

/** Forgets the loaded guide, so the next request reloads (URL change, sign-out). */
export function resetExternalGuide(): void {
  if (open) closeGuide(open.token).catch(() => {});
  open = null;
}

/**
 * Programmes for the given channels from the guide at `url`, shaped as the server's, with ids the
 * program panel never fetches. Channels the guide does not name come back empty; a failed guide
 * load logs and returns nothing, and playback is untouched either way.
 */
export async function fetchExternalPrograms(url: string, channels: readonly { channelId: string; tvgId: string }[], windowMs: { from: number; to: number }): Promise<JellyfinProgram[]> {
  if (!url || channels.length === 0 || !isLiveSourcesAvailable()) return [];
  try {
    const guide = await ensureOpen(url, windowMs);
    const byGuideId = new Map<string, string[]>();
    for (const channel of channels) {
      for (const candidate of candidates(channel.tvgId)) {
        byGuideId.set(candidate, [...(byGuideId.get(candidate) ?? []), channel.channelId]);
      }
    }
    const programmes = await guideProgrammes(guide.token, Array.from(byGuideId.keys()), windowMs);
    const result: JellyfinProgram[] = [];
    for (const programme of programmes) {
      for (const channelId of byGuideId.get(programme.channel) ?? []) {
        result.push({
          Id: `${EXTERNAL_GUIDE_PREFIX}${channelId}:${programme.start}`,
          Name: programme.title,
          ChannelId: channelId,
          StartDate: new Date(programme.start).toISOString(),
          EndDate: programme.stop !== null ? new Date(programme.stop).toISOString() : undefined,
          Overview: programme.desc ?? undefined,
          EpisodeTitle: programme.subTitle ?? undefined,
          Genres: programme.categories,
        });
      }
    }
    return result;
  } catch (error) {
    logger.warn("External guide load failed", error, { service: "ExternalGuide" });
    return [];
  }
}
