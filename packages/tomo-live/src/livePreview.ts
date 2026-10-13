/**
 * The focused channel card's warm session: one engine session read without a server open, started after the
 * focus dwell and adopted by the player when the card is played, so the play press binds instead of opening cold.
 * The card itself keeps its recorded clip. Nothing here ever opens a server stream.
 */
import { engineLog, localRemuxToken, setLiveSessionPriority, setLiveWindow, stopLocalRemux, subscribeEngineFailure, subscribeEngineThroughput } from "@keiver/tomo-engine";
import { AppState } from "react-native";
import { liveChannels } from "./config";
import type { RingSession } from "./liveRing";

/** The session's window until a player adopts it; disk, not playback, is what it bounds. */
const PREVIEW_WINDOW_SECONDS = 20;
const PLAYING_WINDOW_SECONDS = 300;
/** A session left for no other channel stays this long, so the player opening from it can take it over. */
const HANDOFF_GRACE_MS = 5_000;
const READY_SEGMENTS = 2;

interface Preview {
  channelId: string;
  details: unknown;
  url: string;
  token: string;
  segmentsCut: number;
  unsubscribe: () => void;
}

let wanted: string | null = null;
let current: Preview | null = null;
let generation = 0;
let graceTimer: ReturnType<typeof setTimeout> | null = null;

function end(preview: Preview, why: string): void {
  if (current === preview) current = null;
  preview.unsubscribe();
  void stopLocalRemux(preview.token);
  engineLog().debug("Live preview ended", { service: "LivePreview", channel: liveChannels().name(preview.details), why });
}

function clearGrace(): void {
  if (graceTimer) clearTimeout(graceTimer);
  graceTimer = null;
}

async function start(channelId: string, mine: number): Promise<void> {
  let token: string | null = null;
  try {
    const channels = liveChannels();
    const details = await channels.resolveWithoutOpen(channelId);
    if (mine !== generation || !details || !channels.streamUrl(details) || !(await channels.canPlayOnDevice(details))) return;
    const url = await channels.startSession(details, { prewarm: true, liveWindowSeconds: PREVIEW_WINDOW_SECONDS, livePriority: "preview" });
    token = localRemuxToken(url);
    if (!token || mine !== generation) {
      void stopLocalRemux(token);
      return;
    }
    const held = token;
    const preview: Preview = { channelId, details, url, token: held, segmentsCut: 0, unsubscribe: () => {} };
    const stopThroughput = subscribeEngineThroughput(held, () => {
      preview.segmentsCut += 1;
    });
    const stopFailure = subscribeEngineFailure(held, (failure) => {
      if (current === preview) end(preview, failure.message);
    });
    preview.unsubscribe = () => {
      stopThroughput();
      stopFailure();
    };
    current = preview;
  } catch (error) {
    void stopLocalRemux(token);
    engineLog().debug("Live preview did not start", { service: "LivePreview", channelId, error: String(error) });
  }
}

let memoryWired = false;

/** Under memory pressure the warm session goes; the card keeps its clip. */
function wireMemoryWarning(): void {
  if (memoryWired) return;
  memoryWired = true;
  AppState.addEventListener("memoryWarning", () => stopLivePreview());
}

/**
 * The card focused past its dwell names its channel; null when focus leaves the cards. Another channel ends the
 * running session at once (it holds a provider connection); leaving the cards gives the player a moment to adopt it.
 */
export function showLivePreview(channelId: string | null): void {
  wireMemoryWarning();
  if (wanted === channelId) return;
  wanted = channelId;
  generation += 1;
  clearGrace();
  const running = current;
  if (running && running.channelId !== channelId) {
    if (channelId === null) {
      graceTimer = setTimeout(() => {
        graceTimer = null;
        if (current === running && wanted === null) end(running, "focus left");
      }, HANDOFF_GRACE_MS);
    } else {
      end(running, "focus moved");
    }
  }
  if (channelId && current?.channelId !== channelId) void start(channelId, generation);
}

/** The app going to the background lets every connection go now, no grace. */
export function stopLivePreview(): void {
  wanted = null;
  generation += 1;
  clearGrace();
  if (current) end(current, "stopped");
}

/** The player takes the card's warm session instead of opening the channel again; null when there is none. */
export function takeLivePreview<Item = unknown>(channelId: string): RingSession<Item> | null {
  const preview = current;
  if (!preview || preview.channelId !== channelId) return null;
  current = null;
  wanted = null;
  clearGrace();
  preview.unsubscribe();
  void setLiveWindow(preview.token, PLAYING_WINDOW_SECONDS);
  void setLiveSessionPriority(preview.token, "playback");
  engineLog().info("Live preview adopted by the player", { service: "LivePreview", channel: liveChannels().name(preview.details), segments: preview.segmentsCut });
  return { channelId, details: preview.details as Item, url: preview.url, token: preview.token, ready: preview.segmentsCut >= READY_SEGMENTS };
}
