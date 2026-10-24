import { useAuthSession } from "@/hooks/useAuthSession";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { fetchCategoryChannelIds } from "@/services/jellyfinApi";
import { channelSortParam, LIVE_TV_CATEGORIES, type LiveTvCategory } from "@/services/liveTvPreferences";
import { logger } from "@/utils/logger";
import { useEffect, useState } from "react";

export type CategoryChannelIds = Partial<Record<LiveTvCategory, readonly string[]>>;

/** The server's channel ids in each category for the sort, read once per screen; none until they arrive, and a failed read has none. */
export function useCategoryChannelIds(): CategoryChannelIds {
  const [ids, setIds] = useState<CategoryChannelIds>({});
  const session = useAuthSession();
  const { sort } = useLiveTvPreferences();
  const [idsSession, setIdsSession] = useState(session);
  if (idsSession !== session) {
    setIdsSession(session);
    setIds({});
  }
  useEffect(() => {
    let cancelled = false;
    Promise.all(
      LIVE_TV_CATEGORIES.map((category) =>
        fetchCategoryChannelIds(category, channelSortParam(sort))
          .then((found) => [category, found] as const)
          .catch((err) => {
            logger.warn("Channel category load failed", err, { hook: "useCategoryChannelIds", category });
            return [category, []] as const;
          }),
      ),
    ).then((read) => {
      if (!cancelled) setIds(Object.fromEntries(read));
    });
    return () => {
      cancelled = true;
    };
  }, [session, sort]);
  return ids;
}
