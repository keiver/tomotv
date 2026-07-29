import { DiscoveredServer, LocalNetworkInfo, getLocalNetworkInfo, scanLocalNetwork } from "@/services/networkDiscovery";
import { logger } from "@/utils/logger";
import { useCallback, useEffect, useRef, useState } from "react";

export type NetworkScanStatus = "IDLE" | "SCANNING" | "DONE" | "UNSUPPORTED";

export interface UseNetworkScanReturn {
  /** IDLE before the first scan, UNSUPPORTED when this device can't report its own IP */
  status: NetworkScanStatus;
  /** Servers found so far, streamed in during the scan */
  found: DiscoveredServer[];
  /** Hosts probed out of the subnet total */
  progress: { done: number; total: number };
  /** This device's own IPv4 config, available before any scan runs */
  local: LocalNetworkInfo | null;
  /** Sweep the local subnet for Jellyfin servers */
  start: () => void;
  /** Stop an in-flight scan, keeping whatever was already found */
  cancel: () => void;
}

export function useNetworkScan(): UseNetworkScanReturn {
  const [status, setStatus] = useState<NetworkScanStatus>("IDLE");
  const [found, setFound] = useState<DiscoveredServer[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [local, setLocal] = useState<LocalNetworkInfo | null>(null);

  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  // Read the device's own address up front so the connect screen can show it
  // even when the user never starts a scan. That alone tells them which network
  // the TV is on, which is the answer when a server is on a different subnet.
  useEffect(() => {
    mountedRef.current = true;

    (async () => {
      const info = await getLocalNetworkInfo();
      if (!mountedRef.current) return;
      setLocal(info);
      if (!info) setStatus("UNSUPPORTED");
    })();

    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    if (mountedRef.current) setStatus("DONE");
  }, []);

  const start = useCallback(() => {
    if (!local) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setFound([]);
    setProgress({ done: 0, total: 0 });
    setStatus("SCANNING");

    (async () => {
      try {
        await scanLocalNetwork(local, {
          signal: controller.signal,
          onFound: (server) => {
            if (!mountedRef.current || controller.signal.aborted) return;
            setFound((current) => [...current, server]);
          },
          onProgress: (done, total) => {
            if (!mountedRef.current || controller.signal.aborted) return;
            setProgress({ done, total });
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
  }, [local]);

  return { status, found, progress, local, start, cancel };
}
