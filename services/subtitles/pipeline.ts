/**
 * One video's subtitle search and save: the chain for the search; for a pick, the server when the
 * account may save and the viewer wants that, the device otherwise.
 */
import { canManageSubtitles, downloadRemoteSubtitle, externalTextStreams, uploadSubtitle, waitForSubtitleStream } from "@/services/jellyfinApi";
import { getConfig } from "@/services/jellyfin/session";
import { getUiPreferences } from "@/services/uiPreferences";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { markSourceDown, runChain, sourceFor, type ChainAnswer } from "./chain";
import { hasCues, toWebVtt } from "./convert";
import { readOwnKeys } from "./keys";
import { languageFor } from "./languages";
import { rankHits } from "./rank";
import { saveDeviceSubtitle, type DeviceSubtitle } from "./store";
import { SourceRefusal, type SearchContext, type SubtitleFile, type SubtitleHit, type SubtitleQuery } from "./types";
import { isRefusal } from "./sources/http";

export async function searchContext(itemId: string): Promise<SearchContext> {
  const [serverAllowed, keys] = await Promise.all([canManageSubtitles(), readOwnKeys()]);
  return { itemId, serverAllowed, findSubtitles: getUiPreferences().findSubtitles, keys };
}

/** The chain's answer for one file and language, ranked for the list. */
export async function searchSubtitles(itemId: string, query: SubtitleQuery, language: string, context?: SearchContext): Promise<ChainAnswer> {
  const resolved = context ?? (await searchContext(itemId));
  const answer = await runChain(query, language, resolved);
  return { ...answer, hits: rankHits(answer.hits, query) };
}

export type ApplyResult =
  | { ok: true; where: "server"; language: string; streamIndex: number | null }
  | { ok: true; where: "device"; language: string; saved: DeviceSubtitle }
  | { ok: false; reason: "refused" | "unreadable" | "failed"; source: SubtitleHit["source"]; status?: number };

async function readFile(hit: SubtitleHit, context: SearchContext): Promise<SubtitleFile> {
  return sourceFor(hit.source).fetch(hit, context);
}

async function keepOnDevice(item: JellyfinVideoItem, hit: SubtitleHit, file: SubtitleFile): Promise<ApplyResult> {
  const vtt = toWebVtt(file.text, file.format || hit.format);
  if (!vtt || !hasCues(vtt)) return { ok: false, reason: "unreadable", source: hit.source };
  const config = await getConfig();
  const saved = saveDeviceSubtitle({
    server: config.server,
    itemId: item.Id,
    language: hit.language,
    name: hit.name,
    source: hit.source,
    sourceId: hit.id,
    forced: hit.forced,
    hearingImpaired: hit.hearingImpaired,
    vtt,
  });
  if (!saved) return { ok: false, reason: "failed", source: hit.source };
  return { ok: true, where: "device", language: hit.language, saved };
}

/**
 * Saves a pick. With the account allowed and saving on: a server hit is fetched by the server
 * itself, any other is uploaded; both end in the sidecar the server attaches. Otherwise, or when
 * the upload is refused, the file stays on this device.
 */
export async function applyPick(item: JellyfinVideoItem, hit: SubtitleHit, context?: SearchContext): Promise<ApplyResult> {
  const resolved = context ?? (await searchContext(item.Id));
  const saveToServer = resolved.serverAllowed && getUiPreferences().saveSubtitles;
  const known = externalTextStreams(item.MediaStreams).map((stream) => stream.Index as number);
  const row = languageFor(hit.language);

  try {
    if (saveToServer && hit.source === "server") {
      const status = await downloadRemoteSubtitle(item.Id, hit.id);
      if (isRefusal(status)) {
        markSourceDown("server", status);
        return { ok: false, reason: "refused", source: "server", status };
      }
      if (status !== 204 && status !== 200) return { ok: false, reason: "failed", source: "server", status };
      const stream = await waitForSubtitleStream(item.Id, known);
      return { ok: true, where: "server", language: hit.language, streamIndex: stream?.Index ?? null };
    }

    const file = await readFile(hit, resolved);
    if (saveToServer && row) {
      const vtt = toWebVtt(file.text, file.format || hit.format);
      if (!vtt || !hasCues(vtt)) return { ok: false, reason: "unreadable", source: hit.source };
      const format = file.format || hit.format || "srt";
      const status = await uploadSubtitle(item.Id, { language3: row.code3, format, isForced: hit.forced, isHearingImpaired: hit.hearingImpaired, text: file.text });
      if (status === 204 || status === 200) {
        const stream = await waitForSubtitleStream(item.Id, known);
        return { ok: true, where: "server", language: hit.language, streamIndex: stream?.Index ?? null };
      }
      logger.warn("Subtitle upload refused, keeping it on the device", { service: "Subtitles", itemId: item.Id, status });
    }
    return await keepOnDevice(item, hit, file);
  } catch (error) {
    if (error instanceof SourceRefusal) {
      markSourceDown(error.source, error.status);
      return { ok: false, reason: "refused", source: error.source, status: error.status };
    }
    logger.warn("Subtitle apply failed", error, { service: "Subtitles", itemId: item.Id, source: hit.source });
    return { ok: false, reason: "failed", source: hit.source };
  }
}
