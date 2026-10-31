import { isAuthenticated, subscribeAuthChange, waitForConfig } from "@/services/jellyfinApi";
import { getLiveTvPreferences } from "@/services/liveTvPreferences";
import { unwindToLibrary } from "@/utils/rootRoutes";
import { router } from "expo-router";
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from "react";

interface AuthContextType {
  /** True when a Jellyfin session is present (server + token + user id). */
  isConnected: boolean;
  /** True once the initial async config read has resolved (avoids a first-render flash). */
  isReady: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const prevConnectedRef = useRef(false);
  const wasReadyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // Resolve the saved session once at launch, then keep in sync with login/logout.
    waitForConfig().then(() => {
      // An earlier build's lists go to whoever is signed in at its first launch, not to an account switched to later.
      getLiveTvPreferences();
      if (cancelled) return;
      setIsConnected(isAuthenticated());
      setIsReady(true);
    });

    const unsubscribe = subscribeAuthChange(() => setIsConnected(isAuthenticated()));

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  // Route to the Library tab on a runtime login, whichever screen performed it. Guarded so the
  // launch resolution (false to true alongside isReady) doesn't hijack a deep link. This effect and
  // useFinishLogin both fire on a login; the unwind is idempotent.
  useEffect(() => {
    if (wasReadyRef.current && isReady && isConnected && !prevConnectedRef.current) {
      unwindToLibrary(router);
    }
    prevConnectedRef.current = isConnected;
    wasReadyRef.current = isReady;
  }, [isConnected, isReady]);

  const value = useMemo(() => ({ isConnected, isReady }), [isConnected, isReady]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
