/**
 * The XMLTV guide sources live in @keiver/tomo-live; this maps their listings onto the server's
 * program shape, with ids the program panel never fetches.
 */
import type { JellyfinProgram } from "@/types/jellyfin";
import { EXTERNAL_GUIDE_PREFIX } from "@/utils/guide";
import type { GuideChannelRequest } from "@/utils/guideMatch";
import { fetchExternalListingWindow, searchExternalListings, type GuideListing } from "@keiver/tomo-live/src/externalGuide";

export * from "@keiver/tomo-live/src/externalGuide";

function listingProgram({ channelId, programme }: GuideListing): JellyfinProgram {
  return {
    Id: `${EXTERNAL_GUIDE_PREFIX}${channelId}:${programme.start}`,
    Name: programme.title,
    ChannelId: channelId,
    StartDate: new Date(programme.start).toISOString(),
    EndDate: programme.stop !== null ? new Date(programme.stop).toISOString() : undefined,
    Overview: programme.desc ?? undefined,
    EpisodeTitle: programme.subTitle ?? undefined,
    Genres: programme.categories,
  };
}

export async function fetchExternalPrograms(urls: readonly string[], channels: readonly GuideChannelRequest[], windowMs: { from: number; to: number }): Promise<JellyfinProgram[]> {
  return (await fetchExternalProgramWindow(urls, channels, windowMs)).programs;
}

export async function fetchExternalProgramWindow(
  urls: readonly string[],
  channels: readonly GuideChannelRequest[],
  windowMs: { from: number; to: number },
): Promise<{ programs: JellyfinProgram[]; failedChannelIds: string[] }> {
  const { listings, failedChannelIds } = await fetchExternalListingWindow(urls, channels, windowMs);
  return { programs: listings.map(listingProgram), failedChannelIds };
}

/** The guide sources' programmes in the window matching every word of `query`, in the server's program shape. */
export async function searchExternalPrograms(
  urls: readonly string[],
  channels: readonly GuideChannelRequest[],
  windowMs: { from: number; to: number },
  query: string,
  limit: number,
): Promise<JellyfinProgram[]> {
  return (await searchExternalListings(urls, channels, windowMs, query, limit)).map(listingProgram);
}
