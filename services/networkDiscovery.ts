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
import { isLocalNetworkPrimed, LOCAL_NETWORK_GRACE_MS, LOCAL_NETWORK_POLL_MS, markLocalNetworkPrimedFor } from "@/services/localNetworkPermission";
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
  /** Called as work completes, for progress display. Totals are per phase. */
  onProgress?: (done: number, total: number, phase: ScanPhase) => void;
  /** Hosts swept first, e.g. saved server addresses. Hosts outside the subnet are ignored. */
  priorityHosts?: string[];
  signal?: AbortSignal;
}

/**
 * How long a host that is known to be listening may take to answer
 * /System/Info/Public. Generous on purpose: by the time this runs, the TCP
 * handshake has already succeeded, so the only thing left to wait on is the
 * server itself — and a cold .NET pool, a spun-down disk, or a Pi mid-transcode
 * can take seconds. Only a handful of addresses ever reach this stage, so the
 * patience is nearly free.
 */
const PROBE_TIMEOUT_MS = 10000;

/**
 * Budget for the same request when there is no native port scanner and every
 * address has to be probed over HTTP. A middle ground: long enough not to write
 * off a server that is merely slow, short enough that a whole subnet finishes.
 */
const FALLBACK_PROBE_TIMEOUT_MS = 3000;

/** Concurrent HTTP probes. Only reached for addresses already known to listen. */
const CONCURRENCY = 16;

/**
 * Budget for the permission warm-up below. Short on purpose: its job is to raise
 * the Local Network prompt, not to find anything, and every scan waits on it.
 */
const WARMUP_TIMEOUT_MS = 1500;

/**
 * How long to wait for a TCP handshake. A handshake is answered by the peer's
 * kernel, not by Jellyfin, so it lands in single-digit milliseconds on a LAN
 * however busy the server is. Anything past this is an address with nothing on it.
 */
const CONNECT_TIMEOUT_MS = 750;

/** Simultaneous TCP connects handed to the native scanner. */
const CONNECT_CONCURRENCY = 64;

/**
 * Hosts per native call. The native sweep has no cancel handle, so the chunk size
 * is what bounds how long Stop takes to take effect and how often progress moves.
 */
const CONNECT_CHUNK_HOSTS = 32;

/**
 * Largest subnet worth sweeping, in usable hosts. A /23 (510) is common on
 * larger networks and must be swept in full: the device and the server can
 * share a /23 while sitting in different /24s. Anything wider falls back to
 * the device's own /24.
 */
const MAX_SWEEP_HOSTS = 510;

/**
 * Ports to try per host, best-first: when a server answers on more than one, the
 * earlier entry wins. HTTPS is preferred because this URL is the one the user
 * then logs in through, and a self-signed or hostname-mismatched certificate
 * fails the fetch outright and falls through to HTTP, which is the ordinary LAN
 * case. 443 and 80 cover installs behind a reverse proxy, which the manual
 * connect path already treats as first-class (see buildServerUrlCandidates).
 */
const PROBE_TARGETS: { scheme: string; port: number }[] = [
  { scheme: "https", port: 8920 },
  { scheme: "https", port: 443 },
  { scheme: "http", port: 8096 },
  { scheme: "http", port: 80 },
];

/** Which stage of the scan a progress update belongs to. */
export type ScanPhase = "sweep" | "probe";

/** A host/port pair that completed a TCP handshake. */
interface OpenPort {
  host: string;
  port: number;
}

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

/**
 * Move known-interesting hosts (the saved servers) to the front of the sweep, so
 * the server the user is looking for answers in the first chunk instead of
 * whenever the ascending order happens to reach it. Priority entries not in the
 * sweep list (other subnets, hostnames) are dropped.
 */
export function prioritizeHosts(hosts: string[], priority: string[]): string[] {
  const wanted = [...new Set(priority)].filter((host) => hosts.includes(host));
  if (wanted.length === 0) return hosts;
  const wantedSet = new Set(wanted);
  return [...wanted, ...hosts.filter((host) => !wantedSet.has(host))];
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
 * Ask the native scanner which of these host/port pairs complete a TCP handshake.
 *
 * Returns null when the native module is unavailable (Android, web, tests), which
 * tells the caller to fall back to probing every address over HTTP.
 */
async function findOpenPorts(hosts: string[], options: ScanOptions): Promise<OpenPort[] | null> {
  const { onProgress, signal } = options;
  if (Platform.OS !== "ios" || !NetworkInfo?.scanOpenPorts) return null;

  const ports = PROBE_TARGETS.map((target) => target.port);
  const open: OpenPort[] = [];
  let done = 0;
  let chunks = 0;
  let failures = 0;

  for (let index = 0; index < hosts.length; index += CONNECT_CHUNK_HOSTS) {
    if (signal?.aborted) return open;

    const chunk = hosts.slice(index, index + CONNECT_CHUNK_HOSTS);
    chunks++;
    try {
      const found: OpenPort[] = await NetworkInfo.scanOpenPorts(chunk, ports, CONNECT_TIMEOUT_MS, CONNECT_CONCURRENCY);
      open.push(...found);
    } catch (error) {
      // One bad chunk costs those addresses, not the scan.
      failures++;
      logger.warn("Port sweep chunk failed", error, { service: "NetworkDiscovery" });
    }

    done += chunk.length;
    onProgress?.(done, hosts.length, "sweep");
  }

  // A scanner that failed on every chunk has told us nothing, and reporting "no
  // servers" off the back of that would be the same silent lie as a probe killed
  // too early. Hand the caller null so it sweeps over HTTP itself instead.
  if (chunks > 0 && failures === chunks) {
    logger.warn("Port sweep unavailable, falling back to probing every address", { service: "NetworkDiscovery" });
    return null;
  }

  return open;
}

/**
 * Probe one host over a single port and return the server if Jellyfin answers.
 */
async function probeTarget(host: string, port: number, timeoutMs: number, signal?: AbortSignal): Promise<DiscoveredServer | null> {
  const scheme = PROBE_TARGETS.find((target) => target.port === port)?.scheme ?? "http";
  const url = `${scheme}://${host}:${port}`;
  try {
    const info = await checkServerInfo(url, timeoutMs, signal);
    return { url, name: info.ServerName, id: info.Id, version: info.Version };
  } catch {
    // A listening port that isn't Jellyfin is ordinary; so is an aborted probe.
    return null;
  }
}

/**
 * Probe one host across every known port at once.
 *
 * Only used on the fallback path, where nothing has told us which ports are
 * listening. The ports go out together so an address with nothing on it costs a
 * single timeout rather than one per port; results are read in PROBE_TARGETS
 * order so the preferred port still wins when a server answers on several.
 */
async function probeHost(host: string, timeoutMs: number, signal?: AbortSignal): Promise<DiscoveredServer | null> {
  if (signal?.aborted) return null;

  const results = await Promise.all(PROBE_TARGETS.map(({ port }) => probeTarget(host, port, timeoutMs, signal)));
  return results.find((result): result is DiscoveredServer => result !== null) ?? null;
}

/**
 * Run `task` over `items` with a fixed number of workers, stopping on abort.
 */
async function pool<T>(items: T[], workers: number, signal: AbortSignal | undefined, task: (item: T) => Promise<void>): Promise<void> {
  let cursor = 0;
  const worker = async () => {
    while (!signal?.aborted) {
      const index = cursor++;
      if (index >= items.length) return;
      await task(items[index]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(workers, items.length) }, worker));
}

/**
 * Sweep the local subnet for Jellyfin servers.
 *
 * Two stages, because a single HTTP probe cannot tell an empty address apart
 * from a server that is simply slow to answer — both just run out the clock, and
 * a short budget silently writes off the very server the user is looking for:
 *
 *   1. A native TCP connect sweep over every address. A handshake is answered by
 *      the peer's kernel, so it lands in milliseconds no matter how loaded the
 *      server is, and it costs no HTTP stack. This finds the few addresses that
 *      are listening at all.
 *   2. A patient HTTP probe of only those addresses. Nothing is written off for
 *      being slow here, because by this point we know something is listening.
 *
 * Without the native scanner (Android, web, tests) this collapses to probing
 * every address over HTTP on a middling budget, which is the old behaviour.
 *
 * Results are reported through `onFound` as they arrive and also returned as a
 * whole. Deduped by Jellyfin server Id so a server reachable on more than one
 * port appears once.
 *
 * Note on the Local Network permission: on iOS/tvOS the system prompt fires on
 * the first connection to a LAN address and probes in flight while it is
 * pending will fail. A single warm-up probe is awaited first to trigger the
 * prompt before the sweep begins, and on an install whose permission has never
 * been proven granted (see services/localNetworkPermission.ts) an empty sweep
 * is repeated while the user may still be answering, so a scan started before
 * the prompt was ever shown still ends with the server on screen. A denied
 * permission is indistinguishable from an empty network here, so a zero-result
 * scan must stay retryable in the UI.
 */
export async function scanLocalNetwork(local: LocalNetworkInfo, options: ScanOptions = {}): Promise<DiscoveredServer[]> {
  const { signal } = options;
  const hosts = prioritizeHosts(buildSweepHosts(local.ip, local.netmask), options.priorityHosts ?? []);
  if (hosts.length === 0) return [];

  // One connection to a LAN address before the sweep, so the Local Network
  // prompt is raised (and its inevitable failure absorbed) up front. The
  // device's own address is the target because it is guaranteed on-link, and
  // the sweep probes it again anyway, so a hit here is not lost. Pinned to
  // plain HTTP rather than PROBE_TARGETS[0], which would make the warm-up
  // hostage to the port ordering.
  await checkServerInfo(`http://${local.ip}:8096`, WARMUP_TIMEOUT_MS, signal).catch(() => null);
  if (signal?.aborted) return [];

  const deadline = Date.now() + LOCAL_NETWORK_GRACE_MS;
  let found = await sweepSubnet(local, hosts, options);
  // Empty result on an unproven permission: the sweep likely ran under the
  // pending prompt, where every handshake fails. Sweep again until something
  // answers, the permission is proven granted by another path, the user stops
  // the scan, or the window drains (denied, or a genuinely empty network).
  while (found.length === 0 && !signal?.aborted && !isLocalNetworkPrimed() && Date.now() < deadline) {
    await sleep(LOCAL_NETWORK_POLL_MS);
    if (signal?.aborted) break;
    found = await sweepSubnet(local, hosts, options);
  }

  // A found server proves the permission is granted; recording that keeps the
  // connect flow's grace window from engaging on genuinely-down servers later.
  if (found.length > 0) markLocalNetworkPrimedFor(found[0].url);
  return found;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One full pass over the subnet: TCP sweep, then HTTP probes of what listened. */
async function sweepSubnet(local: LocalNetworkInfo, hosts: string[], options: ScanOptions): Promise<DiscoveredServer[]> {
  const { onFound, onProgress, signal, priorityHosts = [] } = options;

  const found: DiscoveredServer[] = [];
  // Keyed by server Id so one server reachable on two ports appears once,
  // falling back to the URL for a server that reports no Id.
  const seen = new Set<string>();
  const record = (server: DiscoveredServer | null) => {
    const key = server?.id || server?.url;
    if (!server || !key || seen.has(key)) return;
    seen.add(key);
    found.push(server);
    onFound?.(server);
  };

  // Priority hosts skip the queue entirely: the sweep's HTTP probes only start
  // after the whole subnet has been swept, and a saved server must not wait for
  // that. The device's own address is always on the list — on the simulator it
  // is the host Mac, which is where the server is in every dev setup. Probed
  // directly, in parallel with the sweep; dedup by server Id absorbs the repeat
  // when the sweep reaches the same host.
  const priority = [...new Set([local.ip, ...priorityHosts])].filter((host) => hosts.includes(host));
  const priorityProbes = Promise.all(priority.map((host) => probeHost(host, FALLBACK_PROBE_TIMEOUT_MS, signal).then(record)));

  const openPorts = await findOpenPorts(hosts, options);
  if (signal?.aborted) {
    await priorityProbes;
    return found;
  }

  if (openPorts === null) {
    let done = 0;
    await pool(hosts, CONCURRENCY, signal, async (host) => {
      const server = await probeHost(host, FALLBACK_PROBE_TIMEOUT_MS, signal);
      done++;
      onProgress?.(done, hosts.length, "probe");
      record(server);
    });
  } else {
    // Grouped by host rather than probed as a flat list of pairs: a host listening
    // on several ports has to resolve its own ports together, or two concurrent
    // probes of the same server would race and dedup would keep whichever
    // happened to answer first instead of the preferred scheme.
    const byHost = new Map<string, number[]>();
    for (const { host, port } of openPorts) {
      byHost.set(host, [...(byHost.get(host) ?? []), port]);
    }
    const listening = [...byHost.entries()];

    let done = 0;
    onProgress?.(0, listening.length, "probe");
    await pool(listening, CONCURRENCY, signal, async ([host, ports]) => {
      const ordered = PROBE_TARGETS.filter((target) => ports.includes(target.port));
      const results = await Promise.all(ordered.map((target) => probeTarget(host, target.port, PROBE_TIMEOUT_MS, signal)));
      done++;
      onProgress?.(done, listening.length, "probe");
      record(results.find((result): result is DiscoveredServer => result !== null) ?? null);
    });
  }

  await priorityProbes;

  logger.info("Local network scan finished", {
    service: "NetworkDiscovery",
    subnet: describeSubnet(local.ip, local.netmask),
    hosts: hosts.length,
    listening: openPorts?.length ?? "n/a (no native port scanner)",
    found: found.length,
  });

  return found;
}
