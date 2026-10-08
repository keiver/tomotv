import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { EXTERNAL_GUIDE_PREFIX, NO_GUIDE_PREFIX } from "@/utils/guide";

/** External listings have no server item to fetch: carry the selected programme into its panel. */
export function programInfoParams(program: JellyfinProgram, channel: Pick<JellyfinItem, "Id" | "Name">): { videoId: string; name: string; guideProgram?: string } {
  if (!program.Id || program.Id.startsWith(NO_GUIDE_PREFIX)) return { videoId: channel.Id, name: channel.Name };
  if (!program.Id.startsWith(EXTERNAL_GUIDE_PREFIX)) return { videoId: program.Id, name: program.Name };
  return {
    videoId: channel.Id,
    name: program.Name,
    guideProgram: JSON.stringify({ ...program, ChannelId: channel.Id, ChannelName: channel.Name }),
  };
}

/** Only programme metadata crosses this route boundary; artwork and playback still use the channel. */
export function readGuideProgram(value: string | undefined, channelId: string): JellyfinItem | null {
  if (!value) return null;
  try {
    const program = JSON.parse(value);
    if (!program || typeof program.Id !== "string" || !program.Id.startsWith(EXTERNAL_GUIDE_PREFIX) || program.ChannelId !== channelId || typeof program.Name !== "string") return null;
    const stringField = (key: string): string | undefined => (typeof program[key] === "string" ? program[key] : undefined);
    return {
      Id: program.Id,
      Type: "Program",
      Path: "",
      Name: program.Name,
      ChannelId: channelId,
      ChannelName: stringField("ChannelName"),
      StartDate: stringField("StartDate"),
      EndDate: stringField("EndDate"),
      Overview: stringField("Overview"),
      EpisodeTitle: stringField("EpisodeTitle"),
      OfficialRating: stringField("OfficialRating"),
      ProductionYear: typeof program.ProductionYear === "number" ? program.ProductionYear : undefined,
      Genres: Array.isArray(program.Genres) ? program.Genres.filter((genre: unknown) => typeof genre === "string") : undefined,
    };
  } catch {
    return null;
  }
}
