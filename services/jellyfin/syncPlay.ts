/**
 * SyncPlay REST surface. Commands the server broadcasts back arrive over the session
 * websocket (./socket.ts); this module only asks. Group reads throw through
 * throwRequestError; transport posts (pause, seek, buffering, ping) log and resolve, since
 * a dropped one must never break playback.
 */
import { logger } from "@/utils/logger";
import { API_TIMEOUTS } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, getConfig, throwRequestError } from "./session";
import { computeClockSample, ServerClockSample } from "../syncPlayTiming";

export type SyncPlayGroupState = "Idle" | "Waiting" | "Paused" | "Playing";
export type SyncPlayAccess = "CreateAndJoinGroups" | "JoinGroups" | "None";

export interface SyncPlayGroupInfo {
  GroupId: string;
  GroupName: string;
  State: SyncPlayGroupState;
  Participants: string[];
  LastUpdatedAt: string;
}

export interface SyncPlayQueueItem {
  ItemId: string;
  PlaylistItemId: string;
}

export interface SyncPlayPlayQueue {
  Reason: string;
  LastUpdate: string;
  Playlist: SyncPlayQueueItem[];
  PlayingItemIndex: number;
  StartPositionTicks: number;
  IsPlaying: boolean;
}

export type SyncPlayCommandType = "Unpause" | "Pause" | "Stop" | "Seek";

export interface SyncPlayCommand {
  GroupId: string;
  PlaylistItemId: string;
  When: string;
  PositionTicks: number;
  Command: SyncPlayCommandType;
  EmittedAt: string;
}

export interface SyncPlayGroupUpdate {
  GroupId: string;
  Type: "UserJoined" | "UserLeft" | "GroupJoined" | "GroupLeft" | "StateUpdate" | "PlayQueue" | "NotInGroup" | "GroupDoesNotExist" | "LibraryAccessDenied";
  Data: unknown;
}

export interface SyncPlayReadyBody {
  When: string;
  PositionTicks: number;
  IsPlaying: boolean;
  PlaylistItemId: string;
}

async function endpoint(): Promise<{ server: string; headers: Record<string, string> } | null> {
  const config = await getConfig();
  if (!config.server || !config.apiKey) return null;
  return {
    server: config.server,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: getAuthHeader(config.deviceId, config.apiKey),
    },
  };
}

async function post(path: string, body?: object): Promise<Response> {
  const target = await endpoint();
  if (!target) throw new Error("Server not configured");
  return fetchWithTimeout(`${target.server}${path}`, { method: "POST", headers: target.headers, ...(body ? { body: JSON.stringify(body) } : {}) }, API_TIMEOUTS.QUICK);
}

/** A post whose failure is logged, never thrown. */
async function postQuietly(path: string, body?: object): Promise<void> {
  try {
    const response = await post(path, body);
    if (!response.ok) {
      logger.warn(`SyncPlay request failed: ${response.status}`, { service: "JellyfinAPI", path });
    }
  } catch (error) {
    logger.warn("SyncPlay request error", error, { service: "JellyfinAPI", path });
  }
}

export async function listSyncPlayGroups(): Promise<SyncPlayGroupInfo[]> {
  const target = await endpoint();
  if (!target) return [];
  const response = await fetchWithTimeout(`${target.server}/SyncPlay/List`, { method: "GET", headers: target.headers }, API_TIMEOUTS.QUICK);
  if (!response.ok) throwRequestError(response, "Could not list groups");
  return (await response.json()) as SyncPlayGroupInfo[];
}

export async function createSyncPlayGroup(groupName: string): Promise<SyncPlayGroupInfo> {
  const response = await post("/SyncPlay/New", { GroupName: groupName });
  if (!response.ok) throwRequestError(response, "Could not create the group");
  return (await response.json()) as SyncPlayGroupInfo;
}

export async function joinSyncPlayGroup(groupId: string): Promise<void> {
  const response = await post("/SyncPlay/Join", { GroupId: groupId });
  if (!response.ok) throwRequestError(response, "Could not join the group");
}

export async function leaveSyncPlayGroup(): Promise<void> {
  await postQuietly("/SyncPlay/Leave");
}

export async function syncPlaySetNewQueue(itemIds: string[], playingItemPosition: number, startPositionTicks: number): Promise<void> {
  const response = await post("/SyncPlay/SetNewQueue", { PlayingQueue: itemIds, PlayingItemPosition: playingItemPosition, StartPositionTicks: startPositionTicks });
  if (!response.ok) throwRequestError(response, "Could not start playback for the group");
}

export function syncPlayPause(): Promise<void> {
  return postQuietly("/SyncPlay/Pause");
}

export function syncPlayUnpause(): Promise<void> {
  return postQuietly("/SyncPlay/Unpause");
}

export function syncPlayStop(): Promise<void> {
  return postQuietly("/SyncPlay/Stop");
}

export function syncPlaySeek(positionTicks: number): Promise<void> {
  return postQuietly("/SyncPlay/Seek", { PositionTicks: Math.round(positionTicks) });
}

export function syncPlayNextItem(playlistItemId: string): Promise<void> {
  return postQuietly("/SyncPlay/NextItem", { PlaylistItemId: playlistItemId });
}

export function syncPlayBuffering(body: SyncPlayReadyBody): Promise<void> {
  return postQuietly("/SyncPlay/Buffering", body);
}

export function syncPlayReady(body: SyncPlayReadyBody): Promise<void> {
  return postQuietly("/SyncPlay/Ready", body);
}

export function syncPlayPing(pingMs: number): Promise<void> {
  return postQuietly("/SyncPlay/Ping", { Ping: Math.round(pingMs) });
}

export function syncPlaySetIgnoreWait(ignoreWait: boolean): Promise<void> {
  return postQuietly("/SyncPlay/SetIgnoreWait", { IgnoreWait: ignoreWait });
}

/** One GetUtcTime round trip, stamped locally either side. Null when the server did not answer. */
export async function measureServerClock(): Promise<ServerClockSample | null> {
  const target = await endpoint();
  if (!target) return null;
  try {
    const t0 = Date.now();
    const response = await fetchWithTimeout(`${target.server}/GetUtcTime`, { method: "GET", headers: target.headers }, API_TIMEOUTS.SHORT);
    const t3 = Date.now();
    if (!response.ok) return null;
    const data = (await response.json()) as { RequestReceptionTime: string; ResponseTransmissionTime: string };
    return computeClockSample(t0, data.RequestReceptionTime, data.ResponseTransmissionTime, t3);
  } catch (error) {
    logger.debug("Server clock sample failed", { service: "JellyfinAPI", error: String(error) });
    return null;
  }
}

let accessCache: { server: string; userId: string; access: SyncPlayAccess } | null = null;

export function resetSyncPlayAccessCache(): void {
  accessCache = null;
}

/** The account's SyncPlayAccess policy, cached per server and account so a switch of either re-asks. */
export async function fetchSyncPlayAccess(): Promise<SyncPlayAccess> {
  const target = await endpoint();
  if (!target) return "None";
  const { userId } = await getConfig();
  if (accessCache?.server === target.server && accessCache.userId === userId) return accessCache.access;
  const response = await fetchWithTimeout(`${target.server}/Users/Me`, { method: "GET", headers: target.headers }, API_TIMEOUTS.QUICK);
  if (!response.ok) throwRequestError(response, "Could not read the account policy");
  const user = (await response.json()) as { Policy?: { SyncPlayAccess?: SyncPlayAccess } };
  const access = user.Policy?.SyncPlayAccess ?? "None";
  accessCache = { server: target.server, userId, access };
  return access;
}
