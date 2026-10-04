import { fetchIsAdministrator } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { useEffect, useState } from "react";

/** The account's administrator flag, false until the server says otherwise. */
export function useIsAdministrator(): boolean {
  const [admin, setAdmin] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchIsAdministrator()
      .then((value) => {
        if (!cancelled) setAdmin(value);
      })
      .catch((err) => logger.warn("Could not read the administrator flag", err, { hook: "useIsAdministrator" }));
    return () => {
      cancelled = true;
    };
  }, []);
  return admin;
}
