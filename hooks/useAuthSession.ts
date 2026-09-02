import { subscribeAuthChange } from "@/services/jellyfinApi";
import { useEffect, useState } from "react";

/**
 * A counter that changes on every login, sign-out and server or account switch. Item ids repeat
 * across servers, so state keyed by id alone survives a switch holding the previous server's
 * data; mixing this in scopes that key to one session.
 */
export function useAuthSession(): number {
  const [session, setSession] = useState(0);
  useEffect(() => subscribeAuthChange(() => setSession((n) => n + 1)), []);
  return session;
}
