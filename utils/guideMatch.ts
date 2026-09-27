/**
 * Pairing a tuner's channels with an XMLTV guide's, in Kodi IPTV Simple's three passes: the
 * tvg-id against the guide channel's id, then the tvg-name against its display-names as written
 * or with spaces as underscores, then the channel name against its display-names. Case is
 * ignored; the first guide channel in file order wins; nothing fuzzier.
 */

/** A channel the guide is asked about; a tuner without tvg attributes leaves them out. */
export interface GuideChannelRequest {
  channelId: string;
  tvgId?: string;
  tvgName?: string;
  name: string;
}

export interface GuideChannelEntry {
  id: string;
  displayNames: string[];
}

export type MatchVia = "id" | "tvgName" | "name";

export interface GuideIndex {
  ids: ReadonlyMap<string, string>;
  /** The id, then each display-name, as written. */
  names: ReadonlyMap<string, string>;
  /** The same with spaces as underscores, for the tvg-name pass. */
  underscored: ReadonlyMap<string, string>;
}

const fold = (value: string) => value.trim().toLowerCase();

function setFirst(map: Map<string, string>, key: string, id: string): void {
  if (key && !map.has(key)) map.set(key, id);
}

export function buildGuideIndex(channels: readonly GuideChannelEntry[]): GuideIndex {
  const ids = new Map<string, string>();
  const names = new Map<string, string>();
  const underscored = new Map<string, string>();
  for (const channel of channels) {
    setFirst(ids, fold(channel.id), channel.id);
    for (const name of [channel.id, ...channel.displayNames]) {
      setFirst(names, fold(name), channel.id);
      setFirst(underscored, fold(name).replace(/ /g, "_"), channel.id);
    }
  }
  return { ids, names, underscored };
}

/** The guide channel each request pairs with, and by which pass; unpaired ones are left out. */
export function matchChannels(index: GuideIndex, requests: readonly GuideChannelRequest[]): Map<string, { guideId: string; via: MatchVia }> {
  const matches = new Map<string, { guideId: string; via: MatchVia }>();
  for (const request of requests) {
    const byId = request.tvgId ? index.ids.get(fold(request.tvgId)) : undefined;
    if (byId) {
      matches.set(request.channelId, { guideId: byId, via: "id" });
      continue;
    }
    const tvgName = request.tvgName ? fold(request.tvgName) : "";
    const byTvgName = tvgName ? (index.names.get(tvgName) ?? index.underscored.get(tvgName)) : undefined;
    if (byTvgName) {
      matches.set(request.channelId, { guideId: byTvgName, via: "tvgName" });
      continue;
    }
    const byName = index.names.get(fold(request.name));
    if (byName) matches.set(request.channelId, { guideId: byName, via: "name" });
  }
  return matches;
}
