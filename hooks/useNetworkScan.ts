import { getSavedServers } from "@/services/jellyfinApi";
import { DiscoveredServer, LocalNetworkInfo, ScanPhase, extractHost, getLocalNetworkInfo, scanLocalNetwork } from "@/services/networkDiscovery";
import { logger } from "@/utils/logger";
import { useEffect, useSyncExternalStore } from "react";

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

/** Attempts to read this device's address at first subscribe, and the gap between them. */
const LOCAL_INFO_ATTEMPTS = 3;
const LOCAL_INFO_RETRY_MS = 2000;

interface ScanState {
  status: NetworkScanStatus;
  found: DiscoveredServer[];
  progress: ScanProgress;
  local: LocalNetworkInfo | null;
}

// Module-level store: the connect widget renders on Library, Search, AND Settings, and all three
// must show the same scan. State lives here so progress, results, and the running sweep itself
// survive any one screen unmounting; hooks subscribe below.
let state: ScanState = { status: "IDLE", found: [], progress: IDLE_PROGRESS, local: null };
const listeners = new Set<() => void>();

let abortController: AbortController | null = null;
let localInfoRequested = false;

function setState(partial: Partial<ScanState>) {
  state = { ...state, ...partial };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function readLocal(): Promise<LocalNetworkInfo | null> {
  const info = await getLocalNetworkInfo();
  setState({ local: info });
  return info;
}

// Read the device's own address up front so the connect screen can show it even
// when the user never starts a scan. That alone tells them which network the TV
// is on, which is the answer when a server is on a different subnet.
//
// Retried a few times because an app launched while Wi-Fi is still associating
// has no address yet, and a single read would leave the row disabled for the
// rest of the session with no way back.
function ensureLocalInfo() {
  if (localInfoRequested) return;
  localInfoRequested = true;

  const attempt = async (remaining: number) => {
    const info = await readLocal();
    if (info) return;

    if (remaining > 1) {
      setTimeout(() => attempt(remaining - 1), LOCAL_INFO_RETRY_MS);
      return;
    }
    if (state.status === "IDLE") setState({ status: "UNSUPPORTED" });
  };

  attempt(LOCAL_INFO_ATTEMPTS);
}

function cancel() {
  abortController?.abort();
  abortController = null;
  // Deliberately not DONE: a stopped scan proves nothing about the subnet, and
  // the row would otherwise announce "no servers found" for a sweep the user
  // interrupted two seconds in.
  setState({ status: "CANCELLED" });
}

function start() {
  abortController?.abort();
  const controller = new AbortController();
  abortController = controller;

  setState({ found: [], progress: IDLE_PROGRESS, status: "SCANNING" });

  const live = () => !controller.signal.aborted;

  (async () => {
    // A device that had no address earlier may well have one by now. Read it
    // outside the try below: a `return` from inside would still run the finally
    // and overwrite this status with DONE, which reads as "nothing out there".
    const info = state.local ?? (await readLocal());
    if (!info) {
      if (abortController === controller) {
        abortController = null;
        setState({ status: "UNSUPPORTED" });
      }
      return;
    }
    if (!live()) return;

    // Saved servers (most recently connected first) are swept before the rest of
    // the subnet, so the server the user already knows shows up immediately.
    const priorityHosts = await getSavedServers()
      .then((servers) => servers.map((server) => extractHost(server.url)))
      .catch(() => []);
    if (!live()) return;

    try {
      await scanLocalNetwork(info, {
        signal: controller.signal,
        priorityHosts,
        onFound: (server) => {
          if (!live()) return;
          setState({ found: [...state.found, server] });
        },
        onProgress: (done, total, phase) => {
          if (!live()) return;
          setState({ progress: { done, total, phase } });
        },
      });
    } catch (error) {
      logger.error("Local network scan failed", error, { service: "NetworkDiscovery" });
    } finally {
      if (abortController === controller) {
        abortController = null;
        setState({ status: "DONE" });
      }
    }
  })();
}

export function useNetworkScan(): UseNetworkScanReturn {
  const snapshot = useSyncExternalStore(subscribe, () => state);

  useEffect(() => {
    ensureLocalInfo();
  }, []);

  return { status: snapshot.status, found: snapshot.found, progress: snapshot.progress, local: snapshot.local, start, cancel };
}
