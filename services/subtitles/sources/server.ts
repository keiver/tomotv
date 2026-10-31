/**
 * The Jellyfin server's own providers (the admin's Open Subtitles plugin). Movies and episodes only,
 * for an account with EnableSubtitleManagement.
 */
import { fetchRemoteSubtitleFile, searchRemoteSubtitles, type RemoteSubtitleInfo } from "@/services/jellyfinApi";
import { languageCode, languageFor } from "../languages";
import { SourceRefusal, type SearchContext, type SubtitleFile, type SubtitleHit, type SubtitleQuery, type SubtitleSource } from "../types";
import { isRefusal } from "./http";

export function serverHit(info: RemoteSubtitleInfo, language: string): SubtitleHit | null {
  if (!info.Id) return null;
  return {
    id: info.Id,
    source: "server",
    name: info.Name?.trim() || info.ProviderName?.trim() || info.Id,
    language: languageCode(info.ThreeLetterISOLanguageName) ?? language,
    format: (info.Format ?? "").toLowerCase(),
    hashMatch: info.IsHashMatch === true,
    forced: info.Forced === true,
    hearingImpaired: info.HearingImpaired === true,
    machineTranslated: info.MachineTranslated === true || info.AiTranslated === true,
    rating: typeof info.CommunityRating === "number" ? info.CommunityRating : null,
    downloads: typeof info.DownloadCount === "number" ? info.DownloadCount : null,
    author: info.Author?.trim() ?? "",
  };
}

export const serverSource: SubtitleSource = {
  id: "server",
  accepts(query, context) {
    return context.serverAllowed && query.kind !== "video";
  },
  async search(query: SubtitleQuery, language: string, context: SearchContext) {
    const row = languageFor(language);
    if (!row) return [];
    const answer = await searchRemoteSubtitles(context.itemId, row.code3);
    if (isRefusal(answer.status)) throw new SourceRefusal("server", answer.status, `server answered ${answer.status}`);
    return answer.results.map((info) => serverHit(info, language)).filter((hit): hit is SubtitleHit => hit !== null);
  },
  async fetch(hit: SubtitleHit): Promise<SubtitleFile> {
    const file = await fetchRemoteSubtitleFile(hit.id);
    if (isRefusal(file.status)) throw new SourceRefusal("server", file.status, `server answered ${file.status}`);
    if (!file.text) throw new Error(`server returned no subtitle (${file.status})`);
    return { text: file.text, format: hit.format };
  },
};
