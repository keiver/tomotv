import { fetchLiveTvManagement } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { useEffect, useState } from "react";

/** The account's recording permission, false until the server says otherwise. Not read while `enabled` is false. */
export function useLiveTvManagement(enabled = true): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchLiveTvManagement()
      .then((value) => {
        if (!cancelled) setAllowed(value);
      })
      .catch((err) => logger.warn("Could not read the recording permission", err, { hook: "useLiveTvManagement" }));
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return allowed;
}
