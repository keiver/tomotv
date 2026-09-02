import { subscribeAuthChange } from "@/services/jellyfinApi";
import { useEffect, useState } from "react";

/**
 * A counter that changes on every login, sign-out and server or account switch.
 *
 * Jellyfin derives an item id from MD5(type + path), so two servers hand out the same id for
 * libraries at the same path. A card keyed by id alone keeps its React key across a switch and
 * outlives it holding the previous server's data. Mixing this into that key scopes it to one
 * session. Every switch path clears the content caches before it notifies, so a refetch this
 * triggers reads the new server.
 */
export function useAuthSession(): number {
  const [session, setSession] = useState(0);
  useEffect(() => subscribeAuthChange(() => setSession((n) => n + 1)), []);
  return session;
}
