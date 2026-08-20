/**
 * localNetworkIdentity.ts
 *
 * What network this device is on: its own IPv4 configuration and the subnet label
 * derived from it. A leaf, importing nothing from services/, so services/jellyfin/
 * can reach it without cycling through the jellyfinApi barrel.
 */

import { NativeModules, Platform } from "react-native";
import { logger } from "@/utils/logger";

const { NetworkInfo } = NativeModules;

/** The device's own IPv4 configuration, from getifaddrs on the native side. */
export interface LocalNetworkInfo {
  ip: string;
  netmask: string;
  interfaceName: string;
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
export function parseIPv4(value: string): number | null {
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
export function formatIPv4(value: number): string {
  return [(value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255].join(".");
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
