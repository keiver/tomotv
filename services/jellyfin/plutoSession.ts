/**
 * Pluto TV channels play on a session this device starts. First the calls Pluto's web player makes
 * (pluto.tv 10.12.2: ptvStart, then streamingUrl), then Pluto's older boot start, then the playlist's
 * own link. A jmp2.uk link carries one shared session placed in another region, which plays empty.
 */
import { uuid } from "expo-modules-core";
import { logger } from "@/utils/logger";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";

const APP_SHELL_GRAPHQL = "https://pluto.tv/api/tn/app-shell/graphql/";
const VIDEO_GRAPHQL = "https://pluto.tv/api/tn/video/graphql/";
/** The web player's stitcher base (its env.STITCHER_BASE_URL). */
const STITCHER = "https://ipv4.pluto.tv/api/tn/video/playout";
const PTV_START = "query PtvStart($params: StartParameters!) { ptvStart(params: $params) { deviceId session { id jwt } refreshInSec } }";
const STREAMING_URL = "query StreamingUrl($params: StreamingUrlParams!) { streamingUrl(params: $params) { success stitcherPaths { type path } } }";
const BOOT_URL = "https://boot.pluto.tv/v4/start";
/** The boot start's fixed parameters, as FastChannels sends them (app/scrapers/pluto.py BOOT_PARAMS_BASE). */
const BOOT_PARAMS: Record<string, string> = {
  appName: "web",
  appVersion: "8.0.0-111b2b9dc00bd0bea9030b30662159ed9e7c8bc6",
  deviceVersion: "122.0.0",
  deviceModel: "web",
  deviceMake: "chrome",
  deviceType: "web",
  clientModelNumber: "1.0.0",
  serverSideAds: "false",
  drmCapabilities: "",
  blockingMode: "",
  notificationVersion: "1",
  appLaunchCount: "",
  lastAppLaunchDate: "",
};
const JMP2_LINK = /^https?:\/\/jmp2\.uk\/plu-([0-9a-f]{24})\.m3u8(?:[?#]|$)/i;
const STITCHER_MASTER = /^https?:\/\/(?:[a-z0-9-]+\.)*pluto\.tv\/(?:[^?#]*\/)?stitch\/hls\/channel\/([0-9a-f]{24})\/master\.m3u8(?:[?#]|$)/i;
/** A failed start or channel lookup is not asked again sooner, so a wall of Pluto cards never repeats it per grab. */
const RETRY_MS = 60_000;
/** Each call's budget: Pluto answered every one in under 1.1 s, so a dead host costs a tune seconds, not a minute. */
const CALL_TIMEOUT_MS = API_TIMEOUTS.SHORT;
/** Used when a start names no refresh time. */
const DEFAULT_REFRESH_MS = 60 * 60_000;

interface WebSession {
  jwt: string;
  /** The CBS_COM cookie ptvStart hands back; streamingUrl answers nothing without it. */
  cookie: string;
  refreshAt: number;
  /** Each channel's stitcher path, asked once per session. */
  paths: Map<string, string>;
  /** When a channel's lookup last failed; the boot start serves it until the retry wait passes. */
  missed: Map<string, number>;
}

interface BootSession {
  stitcher: string;
  params: string;
  token: string;
  refreshAt: number;
}

/** One way of starting a session: the live one, the start in flight, and when the last start failed. */
interface Starter<S extends { refreshAt: number }> {
  session: S | null;
  starting: Promise<S | null> | null;
  failedAt: number;
  start: () => Promise<S>;
}

/** Sent back on every web start, as the web player keeps its ptv_device_id cookie. */
let deviceId = "";
/** One boot client id per app run, as streamlink does; never the Jellyfin device id. */
let bootClientId: string | null = null;

const web: Starter<WebSession> = { session: null, starting: null, failedAt: 0, start: startWeb };
const boot: Starter<BootSession> = { session: null, starting: null, failedAt: 0, start: startBoot };

/** The Pluto channel a playlist link names: a jmp2.uk link or a Pluto stitcher master; null for any other link. */
export function plutoChannelId(url: string): string | null {
  return JMP2_LINK.exec(url)?.[1] ?? STITCHER_MASTER.exec(url)?.[1] ?? null;
}

function refreshAfter(refreshInSec: unknown): number {
  return Date.now() + (typeof refreshInSec === "number" && refreshInSec > 0 ? refreshInSec * 1000 : DEFAULT_REFRESH_MS);
}

/** The web player's GraphQL request; cookies go only as given, never from the system store. */
async function graphql(url: string, operationName: string, query: string, variables: object, cookie?: string): Promise<{ data: Record<string, unknown>; response: Response }> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "apollo-require-preflight": "true",
    "x-apollo-operation-name": operationName,
    ...(cookie ? { Cookie: cookie } : {}),
  };
  const response = await fetchWithTimeout(url, { method: "POST", headers, credentials: "omit", body: JSON.stringify({ operationName, query, variables }) }, CALL_TIMEOUT_MS);
  const body = (await response.json().catch(() => ({}))) as { data?: Record<string, unknown>; errors?: { message?: string }[] };
  if (!response.ok || body.errors?.length || !body.data) throw new Error(`Pluto ${operationName} failed: ${body.errors?.[0]?.message ?? response.status}`);
  return { data: body.data, response };
}

async function startWeb(): Promise<WebSession> {
  const params = { deviceModel: "web", drmCapabilities: "", isClientDNT: false, usPrivacy: "", deviceId, ptvAppName: "web", cmAudienceID: "" };
  const { data, response } = await graphql(APP_SHELL_GRAPHQL, "PtvStart", PTV_START, { params });
  const started = data.ptvStart as { deviceId?: unknown; session?: { jwt?: unknown }; refreshInSec?: unknown } | undefined;
  const jwt = started?.session?.jwt;
  const cookie = /(?:^|[\s,])CBS_COM=([^;,\s]+)/.exec(response.headers.get("x-external-set-cookie") ?? "")?.[1];
  if (typeof jwt !== "string" || !jwt || !cookie) throw new Error("Pluto ptvStart answered without a session");
  if (typeof started?.deviceId === "string") deviceId = started.deviceId;
  return { jwt, cookie: `CBS_COM=${cookie}`, refreshAt: refreshAfter(started?.refreshInSec), paths: new Map(), missed: new Map() };
}

async function startBoot(): Promise<BootSession> {
  bootClientId ??= uuid.v4();
  const query = { ...BOOT_PARAMS, clientID: bootClientId, clientTime: new Date().toISOString() };
  const search = Object.entries(query)
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join("&");
  const response = await fetchWithTimeout(`${BOOT_URL}?${search}`, { headers: { Accept: "application/json" }, credentials: "omit" }, CALL_TIMEOUT_MS);
  if (!response.ok) throw new Error(`Pluto boot start answered ${response.status}`);
  const body = (await response.json()) as { servers?: { stitcher?: unknown }; stitcherParams?: unknown; sessionToken?: unknown; refreshInSec?: unknown };
  const stitcher = body.servers?.stitcher;
  if (typeof stitcher !== "string" || typeof body.stitcherParams !== "string" || typeof body.sessionToken !== "string" || !body.sessionToken) {
    throw new Error("Pluto boot start answered without a session");
  }
  return { stitcher: stitcher.replace(/\/+$/, ""), params: body.stitcherParams, token: body.sessionToken, refreshAt: refreshAfter(body.refreshInSec) };
}

/** The starter's live session, started once for every caller; null while its last failure is under a minute old. */
async function current<S extends { refreshAt: number }>(starter: Starter<S>, name: string): Promise<S | null> {
  const now = Date.now();
  if (starter.session && now < starter.session.refreshAt) return starter.session;
  if (starter.failedAt && now - starter.failedAt < RETRY_MS) return null;
  starter.starting ??= starter
    .start()
    .then(
      (next): S | null => {
        logger.info("Pluto session started", { service: "Pluto", via: name });
        return next;
      },
      (error): S | null => {
        starter.failedAt = Date.now();
        logger.warn("Pluto session did not start", error, { service: "Pluto", via: name });
        return null;
      },
    )
    .then((next) => {
      starter.session = next;
      starter.starting = null;
      return next;
    });
  return starter.starting;
}

/** The channel's HLS stitcher path on the web session, or null when Pluto offers none for it. */
async function stitcherPath(live: WebSession, channelId: string): Promise<string | null> {
  const known = live.paths.get(channelId);
  if (known) return known;
  const missedAt = live.missed.get(channelId);
  if (missedAt !== undefined && Date.now() - missedAt < RETRY_MS) return null;
  try {
    const params = { appVersion: "", contentId: channelId, contentType: "channel", drm: "", drmLevel: "", streamType: "stitcher" };
    const { data } = await graphql(VIDEO_GRAPHQL, "StreamingUrl", STREAMING_URL, { params }, live.cookie);
    const answer = data.streamingUrl as { success?: unknown; stitcherPaths?: { type?: unknown; path?: unknown }[] | null } | undefined;
    const path = answer?.success === true ? answer.stitcherPaths?.find((entry) => entry.type === "hls")?.path : undefined;
    if (typeof path !== "string" || !path.startsWith("/")) throw new Error("Pluto streamingUrl answered no HLS path");
    live.paths.set(channelId, path);
    live.missed.delete(channelId);
    return path;
  } catch (error) {
    live.missed.set(channelId, Date.now());
    logger.warn("Pluto streaming URL unavailable", error, { service: "Pluto", channelId });
    return null;
  }
}

/**
 * The link a Pluto channel plays on this device's session: the web player's flow, else the boot start,
 * else the playlist's link as given. Any other link comes back untouched. Never rejects.
 */
export async function plutoStreamUrl(url: string): Promise<string> {
  const channelId = plutoChannelId(url);
  if (!channelId) return url;
  try {
    return await sessionUrl(channelId, url);
  } catch (error) {
    logger.warn("Pluto session link unavailable, the playlist's link plays as given", error, { service: "Pluto", channelId });
    return url;
  }
}

async function sessionUrl(channelId: string, url: string): Promise<string> {
  const live = await current(web, "web");
  const path = live ? await stitcherPath(live, channelId) : null;
  // The web player's native-HLS form: the token rides the query and the stitcher passes it to every child playlist.
  if (live && path) return `${STITCHER}${path}?jwt=${encodeURIComponent(live.jwt)}&masterJWTPassthrough=true`;
  const fallback = await current(boot, "boot");
  if (fallback) {
    return `${fallback.stitcher}/v2/stitch/hls/channel/${channelId}/master.m3u8?${fallback.params}&jwt=${encodeURIComponent(fallback.token)}&masterJWTPassthrough=true&includeExtendedEvents=true`;
  }
  return url;
}
