/**
 * connectionRecovery.ts
 *
 * Recovers the session when the saved server stops answering — typically the
 * device moved to another LAN or the server's DHCP address changed. Jellyfin
 * access tokens bind to server + device, not to the address, so reaching the
 * SAME server (matched by its stable system Id) at a new URL keeps the session:
 * a URL swap, never a logout. Auto-logout is deliberately absent — a transient
 * Wi-Fi flap must not destroy credentials.
 *
 * Ladder, cheapest first:
 *   1. evaluateSavedConnection — the saved URL answers again (transient blip).
 *   2. restoreLastConnection — same host, different protocol/port.
 *   3. LAN sweep — any discovered server whose Id matches the stored server Id.
 * Anything else resolves "not_found": the UI offers Retry / Switch server.
 */

import { adoptRecoveredServerUrl, evaluateSavedConnection, getStoredServerId, isDemoMode, notifyServerRecovered, restoreLastConnection } from "@/services/jellyfinApi";
import { getLocalNetworkInfo, scanLocalNetwork } from "@/services/networkDiscovery";
import { logger } from "@/utils/logger";
import { AppState } from "react-native";

export type RecoveryStatus = "idle" | "running" | "recovered" | "not_found";

// A failure burst (every visible row erroring at once) must collapse into one
// recovery run; the cooldown also keeps the LAN sweep from re-running on every
// retry while the server is genuinely gone.
const COOLDOWN_MS = 60_000;

let status: RecoveryStatus = "idle";
let inFlight: Promise<RecoveryStatus> | null = null;
let lastAttemptAt = 0;

const listeners = new Set<(status: RecoveryStatus) => void>();

/** Subscribe to recovery-status changes. Returns an unsubscribe function. */
export function subscribeRecoveryStatus(cb: (status: RecoveryStatus) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getRecoveryStatus(): RecoveryStatus {
  return status;
}

function setStatus(next: RecoveryStatus): void {
  if (status === next) return;
  status = next;
  listeners.forEach((cb) => cb(next));
}

/** Test hook: reset module state between cases. */
export function resetRecoveryStateForTests(): void {
  status = "idle";
  inFlight = null;
  lastAttemptAt = 0;
}

/**
 * Try to recover the connection. Single-flight with a cooldown, so callers can
 * fire-and-forget from every failed fetch. Resolves with the outcome status.
 */
export async function attemptConnectionRecovery(): Promise<RecoveryStatus> {
  if (inFlight) return inFlight;
  if (Date.now() - lastAttemptAt < COOLDOWN_MS) return status;
  // Backgrounded app: the OS throttles sockets and the scan would burn its
  // budget against a suspended network stack.
  if (AppState.currentState !== "active") return status;
  // The demo server is on the internet; a LAN sweep can never find it.
  if (await isDemoMode()) return status;

  lastAttemptAt = Date.now();
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<RecoveryStatus> {
  setStatus("running");
  try {
    // 1. Transient blip: the saved URL answers again.
    if ((await evaluateSavedConnection(true)) === "connected") {
      logger.info("Connection recovered: saved URL reachable again", { service: "ConnectionRecovery" });
      setStatus("recovered");
      notifyServerRecovered();
      return status;
    }

    // 2. Same host, different protocol/port (e.g. reverse proxy added/removed).
    try {
      const { url } = await restoreLastConnection();
      logger.info("Connection recovered via host restore", { service: "ConnectionRecovery", url });
      setStatus("recovered");
      return status;
    } catch {
      // Host itself is gone — fall through to the LAN sweep.
    }

    // 3. LAN sweep for the same server at a new address, matched by system Id.
    const serverId = await getStoredServerId();
    if (!serverId) {
      logger.info("No stored server Id; cannot match a moved server", { service: "ConnectionRecovery" });
      setStatus("not_found");
      return status;
    }

    const local = await getLocalNetworkInfo();
    if (!local) {
      setStatus("not_found");
      return status;
    }

    const found = await scanLocalNetwork(local);
    const match = found.find((server) => server.id === serverId);
    if (match) {
      logger.info("Connection recovered: same server found at new address", { service: "ConnectionRecovery", url: match.url });
      await adoptRecoveredServerUrl(match.url);
      setStatus("recovered");
      return status;
    }

    logger.info("Recovery found no matching server on this network", { service: "ConnectionRecovery", discovered: found.length });
    setStatus("not_found");
    return status;
  } catch (error) {
    logger.warn("Connection recovery failed", error, { service: "ConnectionRecovery" });
    setStatus("not_found");
    return status;
  }
}
