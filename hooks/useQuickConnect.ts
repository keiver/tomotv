import { authenticateWithQuickConnect, initiateQuickConnect, pollQuickConnect, saveAuthResult } from "@/services/jellyfinApi";
import { JellyfinAuthResult } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";

export type QuickConnectStatus = "IDLE" | "INITIATING" | "SHOWING_CODE" | "AUTHENTICATED" | "ERROR";

interface UseQuickConnectReturn {
  /** The 6-char code to display to the user */
  code: string | null;
  /** Current status of the Quick Connect flow */
  status: QuickConnectStatus;
  /** Error message if status is ERROR */
  error: string | null;
  /** Auth result once authenticated */
  authResult: JellyfinAuthResult | null;
  /** Start the Quick Connect flow. `serverId` is the server's system Id, persisted for LAN-change recovery. */
  initiate: (serverUrl: string, serverName: string, serverId?: string) => void;
  /** Cancel the current Quick Connect flow */
  cancel: () => void;
}

const POLL_INTERVAL_MS = 5000; // 5 seconds between polls
const TIMEOUT_MS = 300000; // 5 minutes total timeout

export function useQuickConnect(): UseQuickConnectReturn {
  const [code, setCode] = useState<string | null>(null);
  const [status, setStatus] = useState<QuickConnectStatus>("IDLE");
  const [error, setError] = useState<string | null>(null);
  const [authResult, setAuthResult] = useState<JellyfinAuthResult | null>(null);

  const secretRef = useRef<string | null>(null);
  const serverUrlRef = useRef<string | null>(null);
  const serverNameRef = useRef<string | null>(null);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef(false);

  const cleanup = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    cleanup();
    setStatus("IDLE");
    setCode(null);
    setError(null);
    secretRef.current = null;
    serverUrlRef.current = null;
    serverNameRef.current = null;
  }, [cleanup]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup();
    };
  }, [cleanup]);

  const startPolling = useCallback(
    (serverUrl: string, secret: string, serverName: string, serverId?: string) => {
      // Set 5-minute timeout
      timeoutRef.current = setTimeout(() => {
        cleanup();
        setStatus("ERROR");
        setError("Quick Connect timed out. Please try again.");
        logger.warn("Quick Connect timed out", { service: "QuickConnect" });
      }, TIMEOUT_MS);

      // Poll every 5 seconds
      pollIntervalRef.current = setInterval(async () => {
        if (cancelledRef.current) return;

        try {
          const result = await pollQuickConnect(serverUrl, secret);

          if (cancelledRef.current) return;

          if (result.Authenticated) {
            cleanup();

            // Exchange the secret for an access token
            const auth = await authenticateWithQuickConnect(serverUrl, secret);

            if (cancelledRef.current) return;

            // Save credentials
            await saveAuthResult(serverUrl, auth.AccessToken, auth.User.Id, auth.User.Name, serverName, "quickconnect", serverId);

            setAuthResult(auth);
            setStatus("AUTHENTICATED");

            logger.info("Quick Connect authenticated", {
              service: "QuickConnect",
              userName: auth.User.Name,
            });
          }
        } catch (pollError) {
          // Don't fail on individual poll errors — just log and continue
          logger.debug("Quick Connect poll error (will retry)", {
            service: "QuickConnect",
            error: pollError instanceof Error ? pollError.message : "unknown",
          });
        }
      }, POLL_INTERVAL_MS);
    },
    [cleanup],
  );

  const initiate = useCallback(
    (serverUrl: string, serverName: string, serverId?: string) => {
      // Reset state
      cancelledRef.current = false;
      cleanup();
      setError(null);
      setCode(null);
      setAuthResult(null);
      setStatus("INITIATING");
      serverUrlRef.current = serverUrl;
      serverNameRef.current = serverName;

      (async () => {
        try {
          const result = await initiateQuickConnect(serverUrl);

          if (cancelledRef.current) return;

          secretRef.current = result.Secret;
          setCode(result.Code);
          setStatus("SHOWING_CODE");

          // Start polling for approval
          startPolling(serverUrl, result.Secret, serverName, serverId);
        } catch (initiateError) {
          if (cancelledRef.current) return;

          const message = initiateError instanceof Error ? initiateError.message : "Failed to initiate Quick Connect.";
          setError(message);
          setStatus("ERROR");

          logger.error("Quick Connect initiation failed", initiateError, {
            service: "QuickConnect",
          });
        }
      })();
    },
    [cleanup, startPolling],
  );

  return { code, status, error, authResult, initiate, cancel };
}
