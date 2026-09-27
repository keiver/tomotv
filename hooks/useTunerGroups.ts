import { useAuthSession } from "@/hooks/useAuthSession";
import { fetchTunerGroups, lastKnownTunerData, type TunerGroup } from "@/services/jellyfinApi";
import { activePlaylistGroup, updateLiveTvPreferences, type ChannelFilter } from "@/services/liveTvPreferences";
import { logger } from "@/utils/logger";
import { useEffect, useState } from "react";

const NO_IDS: readonly string[] = [];

/** The server's playlist groups, read once per screen; null until they arrive. A failed read shows the last good ones. */
export function useTunerGroups(): TunerGroup[] | null {
  const [groups, setGroups] = useState<TunerGroup[] | null>(() => lastKnownTunerData()?.groups ?? null);
  // Another sign-in reads its own server's groups; until then the filter waits rather than judging the last server's.
  const session = useAuthSession();
  const [groupsSession, setGroupsSession] = useState(session);
  if (groupsSession !== session) {
    setGroupsSession(session);
    setGroups(lastKnownTunerData()?.groups ?? null);
  }
  useEffect(() => {
    let cancelled = false;
    fetchTunerGroups()
      .then((found) => {
        if (!cancelled) setGroups(found);
      })
      .catch((err) => {
        logger.warn("Tuner groups load failed", err, { hook: "useTunerGroups" });
        if (!cancelled) setGroups(lastKnownTunerData()?.groups ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [session]);
  return groups;
}

/** The channel ids of the playlist group the filter names: null for any other filter, "loading" until the groups arrive. */
export function usePlaylistChannelIds(filter: ChannelFilter): readonly string[] | "loading" | null {
  const groups = useTunerGroups();
  const name = activePlaylistGroup(filter);
  // A group a SUCCESSFUL load does not name is gone (server switch, tuner removed): show everything
  // again. A failed load never resets: the tuner may still have the group.
  const dead = name !== null && groups !== null && lastKnownTunerData() !== null && !groups.some((group) => group.name === name);
  useEffect(() => {
    if (dead) updateLiveTvPreferences({ filter: "all" });
  }, [dead]);
  if (!name) return null;
  if (!groups) return "loading";
  return groups.find((group) => group.name === name)?.channelIds ?? NO_IDS;
}
