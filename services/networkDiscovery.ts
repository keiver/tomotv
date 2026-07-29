/**
 * networkDiscovery.ts
 *
 * Finds Jellyfin servers on the same LAN as this device, so the user never has
 * to know the server's IP or port.
 *
 * Jellyfin's own discovery protocol is a UDP broadcast to port 7359, which is
 * faster and returns the server's published address directly. It is not used
 * here: sending to a broadcast address on iOS/tvOS requires Apple's
 * com.apple.developer.networking.multicast entitlement, which has to be
 * requested and approved before it works on device. Instead this sweeps the
 * local subnet over plain HTTP, which needs no entitlement and also works when
 * Jellyfin's UDP discovery is disabled server-side.
 */

import { checkServerInfo } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { NativeModules, Platform } from "react-native";

const { NetworkInfo } = NativeModules;

/** The device's own IPv4 configuration, from getifaddrs on the native side. */
export interface LocalNetworkInfo {
  ip: string;
  netmask: string;
  interfaceName: string;
}

/** A Jellyfin server found by sweeping the local subnet. */
export interface DiscoveredServer {
  /** Working base URL, e.g. "http://10.48.1.51:8096". */
  url: string;
  name: string;
  /** Jellyfin server Id, used to dedup a server reachable on more than one port. */
  id: string;
  version: string;
}

export interface ScanOptions {
  /** Called as soon as each server is found, so results can stream into the UI. */
  onFound?: (server: DiscoveredServer) => void;
  /** Called after each host finishes, for progress display. */
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

/** How long a single host probe may take. A LAN host answers fast or is not there. */
const PROBE_TIMEOUT_MS = 1500;

/** Concurrent host probes. High enough to sweep a /23 in well under a minute, low enough not to swamp the TV's networking stack. */
const CONCURRENCY = 32;

/**
 * Largest subnet worth sweeping, in usable hosts. A /23 (510) is common on
 * larger networks and must be swept in full: the device and the server can
 * share a /23 while sitting in different /24s. Anything wider falls back to
 * the device's own /24.
 */
const MAX_SWEEP_HOSTS = 510;

/**
 * Ports to try per host. Probed concurrently so an absent host costs one
 * timeout rather than one per port; ties resolve in this order.
 */
const PROBE_TARGETS: { scheme: string; port: number }[] = [
  { scheme: "http", port: 8096 },
  { scheme: "https", port: 8920 },
];

/**
 * Read this device's IPv4 address and netmask.
 *
 * Returns null when the native module is unavailable (Android, web, tests) or
 * the device has no usable interface, so callers degrade to manual entry
 * instead of throwing.
 */
export async function getLocalNetworkInfo(): Promise<LocalNetworkInfo | null> {
  if (Platform.OS !== "ios" || !NetworkInfo?.getLocalNetworkInfo) {
    return null;
  }
  try {
    const info = await NetworkInfo.getLocalNetworkInfo();
    if (!info?.ip || !info?.netmask) return null;
    return info as LocalNetworkInfo;
  } catch (error) {
    logger.warn("Failed to read local network info", error, { service: "NetworkDiscovery" });
    return null;
  }
}

/** Parse dotted-quad IPv4 text into a number. Returns null for anything malformed. */
function parseIPv4(value: string): number | null {
  const parts = value.trim().split(".");
  if (parts.length !== 4) return null;

  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (octet > 255) return null;
    result = result * 256 + octet;
  }
  return result;
}

/** Format a number back into dotted-quad IPv4 text. */
function formatIPv4(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
}

/**
 * List every host address to probe on the device's local subnet.
 *
 * The interface's real netmask is honoured up to MAX_SWEEP_HOSTS, so a /23 (a
 * common shape on larger networks) is swept end to end. That matters: on a /23
 * the device and the server routinely land in different /24s, and clamping to
 * /24 would silently skip the half the server is on. Wider
 * subnets fall back to the device's own /24, since a /16 is 65k hosts and not
 * sweepable on an Apple TV.
 *
 * Only the network and broadcast addresses are excluded. The device's own
 * address is deliberately probed: on the iOS/tvOS simulator the "device" IP is
 * the host Mac's, so skipping it would hide a Jellyfin server running on the
 * same machine, which is the usual way this gets tested.
 */
export function buildSweepHosts(ip: string, netmask: string): string[] {
  const address = parseIPv4(ip);
  const mask = parseIPv4(netmask);
  if (address === null || mask === null) return [];

  // Usable hosts for the real mask, i.e. the block minus network and broadcast.
  const usableHosts = (~mask >>> 0) - 1;
  // Setting the top 24 bits narrows an over-wide subnet to the device's own /24
  // and would leave anything already narrower untouched.
  const effectiveMask = usableHosts > MAX_SWEEP_HOSTS ? (mask | 0xffffff00) >>> 0 : mask;
  const network = (address & effectiveMask) >>> 0;
  const broadcast = (network | (~effectiveMask >>> 0)) >>> 0;

  const hosts: string[] = [];
  for (let candidate = network + 1; candidate < broadcast; candidate++) {
    hosts.push(formatIPv4(candidate));
  }
  return hosts;
}

/** True for RFC 1918 ranges plus link-local, i.e. addresses that only work on a local network. */
function isPrivateIPv4(address: number): boolean {
  const a = (address >>> 24) & 255;
  const b = (address >>> 16) & 255;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  return false;
}

/** Pull the bare host out of a user-entered address, dropping scheme, port, and path. */
export function extractHost(input: string): string {
  return input
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^\/+/, "")
    .split("/")[0]
    .split(":")[0];
}

/**
 * Explain a private address that is not on this device's subnet, which is a
 * common reason a manually entered IP never responds.
 *
 * Compares against the interface's real netmask, not an assumed /24: on a /23
 * the device and the server routinely sit in different /24s while being on the
 * same subnet, and warning about that would be plain wrong. Returns null unless
 * the target is an IPv4 literal in a private range genuinely outside this
 * device's subnet. Deliberately hedged, since private subnets can be routed to
 * each other across VLANs.
 */
export function subnetMismatchHint(input: string, local: LocalNetworkInfo | null): string | null {
  if (!local) return null;

  const target = parseIPv4(extractHost(input));
  const device = parseIPv4(local.ip);
  const mask = parseIPv4(local.netmask);
  if (target === null || device === null || mask === null) return null;
  if (!isPrivateIPv4(target)) return null;

  const sameSubnet = (target & mask) >>> 0 === (device & mask) >>> 0;
  if (sameSubnet) return null;

  return `This device is on ${describeSubnet(local.ip, local.netmask)}, but that address is outside it. Unless those networks are routed to each other, the server won't be reachable from here.`;
}

/** Count the leading 1-bits of a netmask, e.g. 255.255.254.0 -> 23. */
function maskToPrefix(mask: number): number {
  let prefix = 0;
  for (let bit = 31; bit >= 0 && (mask & (1 << bit)) !== 0; bit--) prefix++;
  return prefix;
}

/**
 * Human-readable label for a subnet. With a netmask this is exact CIDR
 * ("10.48.0.0/23"); without one it falls back to the /24 the address sits in.
 */
export function describeSubnet(ip: string, netmask?: string): string {
  const address = parseIPv4(ip);
  const mask = netmask ? parseIPv4(netmask) : null;

  if (address !== null && mask !== null) {
    return `${formatIPv4((address & mask) >>> 0)}/${maskToPrefix(mask)}`;
  }

  const parts = ip.split(".");
  return parts.length === 4 ? `${parts[0]}.${parts[1]}.${parts[2]}.x` : ip;
}

/**
 * Probe one host across the known Jellyfin ports.
 *
 * The ports go out concurrently so an address with nothing on it costs a single
 * timeout instead of one per port, which halves the worst case on a subnet where
 * most hosts never answer. Results are still read in PROBE_TARGETS order, so the
 * preferred port wins when a server answers on both.
 */
async function probeHost(host: string, signal?: AbortSignal): Promise<DiscoveredServer | null> {
  if (signal?.aborted) return null;

  const results = await Promise.all(
    PROBE_TARGETS.map(async ({ scheme, port }) => {
      const url = `${scheme}://${host}:${port}`;
      try {
        const info = await checkServerInfo(url, PROBE_TIMEOUT_MS);
        return { url, name: info.ServerName, id: info.Id, version: info.Version };
      } catch {
        // Expected for the overwhelming majority of addresses on the subnet.
        return null;
      }
    }),
  );

  return results.find((result): result is DiscoveredServer => result !== null) ?? null;
}

/**
 * Sweep the local subnet for Jellyfin servers.
 *
 * Results are reported through `onFound` as they arrive and also returned as a
 * whole when the sweep finishes. Deduped by Jellyfin server Id so a server
 * reachable on both HTTP and HTTPS appears once.
 *
 * Note on the Local Network permission: on tvOS the system prompt fires on the
 * first connection to a LAN address and probes in flight while it is pending
 * will fail. A single warm-up probe is awaited first to trigger and settle that
 * prompt before the sweep begins. A denied permission is indistinguishable from
 * an empty network here, so a zero-result sweep must stay retryable in the UI.
 */
export async function scanLocalNetwork(local: LocalNetworkInfo, options: ScanOptions = {}): Promise<DiscoveredServer[]> {
  const { onFound, onProgress, signal } = options;
  const hosts = buildSweepHosts(local.ip, local.netmask);
  if (hosts.length === 0) return [];

  // One connection to a LAN address before the sweep, so the tvOS Local Network
  // prompt is raised (and its inevitable failure absorbed) up front. Deliberately
  // a single probe: the user's response time dwarfs any warm-up we could wait
  // out, so the zero-result retry in the UI is the real remedy. The device's own
  // address is the target because it is guaranteed on-link, and the sweep probes
  // it again anyway, so a hit here is not lost.
  const { scheme, port } = PROBE_TARGETS[0];
  await checkServerInfo(`${scheme}://${local.ip}:${port}`, PROBE_TIMEOUT_MS).catch(() => null);
  if (signal?.aborted) return [];

  const found: DiscoveredServer[] = [];
  // Keyed by server Id so one server reachable on two ports appears once,
  // falling back to the URL for a server that reports no Id.
  const seen = new Set<string>();
  let cursor = 0;
  let done = 0;

  const worker = async () => {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= hosts.length) return;

      const server = await probeHost(hosts[index], signal);

      done++;
      onProgress?.(done, hosts.length);

      const key = server?.id || server?.url;
      if (server && key && !seen.has(key)) {
        seen.add(key);
        found.push(server);
        onFound?.(server);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, hosts.length) }, worker));

  logger.info("Local network scan finished", {
    service: "NetworkDiscovery",
    subnet: describeSubnet(local.ip),
    scanned: done,
    found: found.length,
  });

  return found;
}
