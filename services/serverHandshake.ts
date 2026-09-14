/**
 * serverHandshake.ts
 *
 * Whether a server on this device's own subnet accepts a TCP connection, asked of the native
 * handshake sweep the network scan uses. A request to such a server gives up at the handshake
 * budget instead of waiting out its own timeout. A leaf, like localNetworkIdentity.
 */

import { NativeModules, Platform } from "react-native";
import { getLocalNetworkInfo, parseIPv4, type LocalNetworkInfo } from "@/services/localNetworkIdentity";

const { NetworkInfo } = NativeModules;

/** Handshake budget on the local subnet, shared with the network scan. A live server on this LAN answered a Mac in 1ms. */
export const LAN_CONNECT_TIMEOUT_MS = 750;

/** An answer stands this long, so a burst of requests costs one connect and one interface read. */
const ANSWER_REUSE_MS = 5_000;

/** The IPv4 literal host and port of an http(s) URL; null for a hostname or anything else. */
export function ipv4Endpoint(url: string): { host: string; port: number } | null {
  const match = /^(https?):\/\/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?(?:[/?#]|$)/i.exec(url.trim());
  if (!match || parseIPv4(match[2]) === null) return null;
  const port = match[3] ? Number(match[3]) : match[1].toLowerCase() === "https" ? 443 : 80;
  return port > 0 && port <= 65535 ? { host: match[2], port } : null;
}

/** Whether `host` sits on the subnet of `local`: reached on-link, never through a router or a tunnel. */
export function onSubnet(host: string, local: LocalNetworkInfo): boolean {
  const target = parseIPv4(host);
  const device = parseIPv4(local.ip);
  const mask = parseIPv4(local.netmask);
  if (target === null || device === null || mask === null) return false;
  return (target & mask) >>> 0 === (device & mask) >>> 0;
}

let localRead: { at: number; info: Promise<LocalNetworkInfo | null> } | null = null;

function localNetwork(): Promise<LocalNetworkInfo | null> {
  if (localRead && Date.now() - localRead.at < ANSWER_REUSE_MS) return localRead.info;
  localRead = { at: Date.now(), info: getLocalNetworkInfo() };
  return localRead.info;
}

const accepted = new Map<string, { at: number; open: Promise<boolean> }>();

/** False only when the sweep answered that nothing accepted the connection; a sweep that failed says nothing. */
function accepts(host: string, port: number): Promise<boolean> {
  const key = `${host}:${port}`;
  const known = accepted.get(key);
  if (known && Date.now() - known.at < ANSWER_REUSE_MS) return known.open;
  const open = (NetworkInfo.scanOpenPorts([host], [port], LAN_CONNECT_TIMEOUT_MS, 1) as Promise<unknown>).then(
    (found) => !Array.isArray(found) || found.length > 0,
    () => true,
  );
  const entry = { at: Date.now(), open };
  accepted.set(key, entry);
  // A refusal is asked again by the next request: the server may be back.
  void open.then((isOpen) => {
    if (!isOpen && accepted.get(key) === entry) accepted.delete(key);
  });
  return open;
}

/**
 * Calls `onRefused` when the URL's server is on this device's subnet and does not accept a
 * connection within the budget. Hostnames, other networks and a missing scanner are not watched.
 * The returned function stops the watch.
 */
export function watchServerHandshake(url: string, onRefused: () => void): () => void {
  const endpoint = ipv4Endpoint(url);
  if (!endpoint || Platform.OS !== "ios" || typeof NetworkInfo?.scanOpenPorts !== "function") return () => {};
  let watching = true;
  void (async () => {
    const local = await localNetwork();
    if (!watching || !local || !onSubnet(endpoint.host, local)) return;
    const open = await accepts(endpoint.host, endpoint.port);
    if (watching && !open) onRefused();
  })();
  return () => {
    watching = false;
  };
}

/** Test hook: forget every cached answer. */
export function resetServerHandshakeForTests(): void {
  accepted.clear();
  localRead = null;
}
