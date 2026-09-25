import { fetchChannelCategories } from "@/services/jellyfinApi";
import type { LiveTvCategory } from "@/services/liveTvPreferences";
import { logger } from "@/utils/logger";
import { useEffect, useState } from "react";

/** The server's non-empty channel categories, read once per screen; none until they arrive or when the read fails. */
export function useLiveTvCategories(): LiveTvCategory[] {
  const [categories, setCategories] = useState<LiveTvCategory[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetchChannelCategories()
      .then((found) => {
        if (!cancelled) setCategories(found);
      })
      .catch((err) => logger.warn("Channel categories load failed", err, { hook: "useLiveTvCategories" }));
    return () => {
      cancelled = true;
    };
  }, []);
  return categories;
}
