import { fetchLiveTvManagement } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { useEffect, useState } from "react";

/** The account's recording permission: undefined until read, false when the read fails. Not read while `enabled` is false. */
export function useLiveTvManagement(enabled = true): boolean | undefined {
  const [allowed, setAllowed] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchLiveTvManagement()
      .then((value) => {
        if (!cancelled) setAllowed(value);
      })
      .catch((err) => {
        logger.warn("Could not read the recording permission", err, { hook: "useLiveTvManagement" });
        if (!cancelled) setAllowed(false);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled]);
  return allowed;
}
