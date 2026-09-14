import { fetchLiveTvManagement } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { useEffect, useState } from "react";

/** The account's recording permission, false until the server says otherwise. */
export function useLiveTvManagement(): boolean {
  const [allowed, setAllowed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchLiveTvManagement()
      .then((value) => {
        if (!cancelled) setAllowed(value);
      })
      .catch((err) => logger.warn("Could not read the recording permission", err, { hook: "useLiveTvManagement" }));
    return () => {
      cancelled = true;
    };
  }, []);
  return allowed;
}
