/**
 * localNetworkPermission.ts
 *
 * Inferred state of the iOS/tvOS Local Network permission, which has no query
 * API: the system prompt fires on the app's first-ever LAN connection and fails
 * requests in flight while it is pending, so on a fresh install the first
 * saved-server tap or network scan dies even though the user allows a moment
 * later.
 *
 * A marker file in the app container records that a LAN probe has succeeded
 * once, which proves the permission was granted. The container is wiped on
 * uninstall (unlike the Keychain, which is why saved servers survive a
 * reinstall), so an absent marker means the prompt may be about to interrupt
 * the next attempt — and only in that state do the connect flow and the scan
 * keep retrying while the user answers.
 *
 * Only a success against a local-looking host counts: reaching a public host
 * (the demo server, a reverse proxy on a public name) never shows the prompt,
 * so it proves nothing and must not disarm the grace window. The cost of the
 * conservative default is bounded: an install that only ever reaches public
 * hosts keeps the grace window armed, which slows nothing but a failing
 * connect.
 */
import { Platform } from "react-native";

const MARKER_FILENAME = "local-network-primed";

/** How long a failed first-ever attempt keeps retrying for the prompt's answer. */
export const LOCAL_NETWORK_GRACE_MS = 30_000;
/** Pause between retries; prompt-blocked sockets fail in milliseconds. */
export const LOCAL_NETWORK_POLL_MS = 1_000;

/**
 * The marker file, or null where the file API is unavailable. Required lazily
 * so expo-file-system stays out of the module graph for the many test suites
 * that import consumers of this module without mocking it.
 */
function localNetworkMarker(): { exists: boolean; create(): void } | null {
  try {
    const { File, Paths } = require("expo-file-system");
    return new File(Paths.document, MARKER_FILENAME);
  } catch {
    return null;
  }
}

/**
 * Whether a LAN probe has ever succeeded on this install. Only a positively
 * absent marker opens the retry grace window; any doubt (no file API, Android,
 * an exists read that throws or isn't the boolean false) means behave exactly
 * as before the marker existed: one attempt, immediate error.
 */
export function isLocalNetworkPrimed(): boolean {
  if (Platform.OS !== "ios") return true;
  try {
    const marker = localNetworkMarker();
    return marker ? marker.exists !== false : true;
  } catch {
    return true;
  }
}

/**
 * Record that a probe of `url` succeeded. Writes the marker only when the
 * target looks local — see the module comment for why a public success must
 * not count.
 */
export function markLocalNetworkPrimedFor(url: string): void {
  if (!isLanHost(url)) return;
  try {
    const marker = localNetworkMarker();
    if (marker && marker.exists === false) marker.create();
  } catch {
    // Non-fatal: the only cost is a retry window on some future failed connect.
  }
}

/**
 * Whether a URL's host can only exist on a local network: an RFC 1918 or
 * link-local IPv4 literal, a single-label hostname, or an mDNS/private-use
 * suffix. Public names resolve through DNS and say nothing about the Local
 * Network permission even when split DNS points them at a LAN address — that
 * case stays unmarked, which errs toward keeping the grace window armed.
 */
function isLanHost(url: string): boolean {
  const host = url
    .trim()
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .split(":")[0]
    .toLowerCase();
  if (!host) return false;

  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    const [a, b] = octets;
    if (a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (!host.includes(".")) return true;
  return /\.(local|lan|home|internal|arpa)$/.test(host);
}
