import { DiscoveredServer, LocalNetworkInfo, ScanPhase, getLocalNetworkInfo, scanLocalNetwork } from "@/services/networkDiscovery";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";

export type NetworkScanStatus = "IDLE" | "SCANNING" | "DONE" | "CANCELLED" | "UNSUPPORTED";

export interface ScanProgress {
  done: number;
  total: number;
  phase: ScanPhase;
}

export interface UseNetworkScanReturn {
  /** IDLE before the first scan, UNSUPPORTED when this device can't report its own IP */
  status: NetworkScanStatus;
  /** Servers found so far, streamed in during the scan */
  found: DiscoveredServer[];
  /** How far along the current phase is */
  progress: ScanProgress;
  /** This device's own IPv4 config, available before any scan runs */
  local: LocalNetworkInfo | null;
  /** Sweep the local subnet for Jellyfin servers */
  start: () => void;
  /** Stop an in-flight scan, keeping whatever was already found */
  cancel: () => void;
}

const IDLE_PROGRESS: ScanProgress = { done: 0, total: 0, phase: "sweep" };

/** Attempts to read this device's address at mount, and the gap between them. */
const LOCAL_INFO_ATTEMPTS = 3;
const LOCAL_INFO_RETRY_MS = 2000;

export function useNetworkScan(): UseNetworkScanReturn {
  const [status, setStatus] = useState<NetworkScanStatus>("IDLE");
  const [found, setFound] = useState<DiscoveredServer[]>([]);
  const [progress, setProgress] = useState<ScanProgress>(IDLE_PROGRESS);
  const [local, setLocal] = useState<LocalNetworkInfo | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  // Mirrors `local` for start(), which would otherwise close over a stale value
  // when it re-reads the address itself.
  const localRef = useRef<LocalNetworkInfo | null>(null);

  const readLocal = useCallback(async () => {
    const info = await getLocalNetworkInfo();
    if (!mountedRef.current) return null;
    localRef.current = info;
    setLocal(info);
    return info;
  }, []);

  // Read the device's own address up front so the connect screen can show it even
  // when the user never starts a scan. That alone tells them which network the TV
  // is on, which is the answer when a server is on a different subnet.
  //
  // Retried a few times because an app launched while Wi-Fi is still associating
  // has no address yet, and a single read would leave the row disabled for the
  // rest of the session with no way back.
  useEffect(() => {
    mountedRef.current = true;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const attempt = async (remaining: number) => {
      const info = await readLocal();
      if (!mountedRef.current || info) return;

      if (remaining > 1) {
        timer = setTimeout(() => attempt(remaining - 1), LOCAL_INFO_RETRY_MS);
        return;
      }
      setStatus((current) => (current === "IDLE" ? "UNSUPPORTED" : current));
    };

    attempt(LOCAL_INFO_ATTEMPTS);

    return () => {
      mountedRef.current = false;
      if (timer) clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [readLocal]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    // Deliberately not DONE: a stopped scan proves nothing about the subnet, and
    // the row would otherwise announce "no servers found" for a sweep the user
    // interrupted two seconds in.
    if (mountedRef.current) setStatus("CANCELLED");
  }, []);

  const start = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFound([]);
    setProgress(IDLE_PROGRESS);
    setStatus("SCANNING");

    const live = () => mountedRef.current && !controller.signal.aborted;

    (async () => {
      // A device that had no address at mount may well have one by now. Read it
      // outside the try below: a `return` from inside would still run the finally
      // and overwrite this status with DONE, which reads as "nothing out there".
      const info = localRef.current ?? (await readLocal());
      if (!info) {
        if (mountedRef.current && abortRef.current === controller) {
          abortRef.current = null;
          setStatus("UNSUPPORTED");
        }
        return;
      }
      if (!live()) return;

      try {
        await scanLocalNetwork(info, {
          signal: controller.signal,
          onFound: (server) => {
            if (!live()) return;
            setFound((current) => [...current, server]);
          },
          onProgress: (done, total, phase) => {
            if (!live()) return;
            setProgress({ done, total, phase });
          },
        });
      } catch (error) {
        logger.error("Local network scan failed", error, { service: "NetworkDiscovery" });
      } finally {
        if (mountedRef.current && abortRef.current === controller) {
          abortRef.current = null;
          setStatus("DONE");
        }
      }
    })();
  }, [readLocal]);

  return { status, found, progress, local, start, cancel };
}
