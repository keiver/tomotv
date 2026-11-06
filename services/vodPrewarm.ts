/**
 * One engine session opened on an item's page before Play, handed to the player when it opens that item
 * with the same audio track, resume point and subtitle. Only a copy with a ladder on a link remembered to
 * carry it, so no server encode starts for an item nobody plays.
 */
import { attributeSession, localRemuxToken, stopLocalRemux, subscribeEngineFailure } from "@keiver/tomo-engine";
import { AppState } from "react-native";

import { resolveResume } from "@/hooks/videoPlayback/resume";
import { startingSubtitleRendition } from "@/hooks/videoPlayback/subtitleSession";
import { preferredAudioStreamIndex, readAudioPreference } from "@/services/audioPreference";
import { playsFromDisk } from "@/services/downloads/localSource";
import { rememberedBitrate } from "@/services/jellyfin/bitrateTest";
import { isAudioItem, isLiveSource } from "@/services/jellyfin/media";
import { fetchVideoDetails } from "@/services/jellyfinApi";
import { offeredTierRungs, predictPlaybackLane, sessionSubtitleRenditions, sourceBandwidthForItem, startLocalRemux } from "@/services/localRemux";
import { getAudioTracks } from "@/services/multiAudioLoader";
import { isPlaybackHeld, onPlaybackHoldTaken } from "@/services/playbackHold";
import { getSubtitlePreferenceSync } from "@/services/subtitlePreference";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";

/** How long the page stays up before its session opens: a page passed through opens nothing. */
export const VOD_PREWARM_DWELL_MS = 2_000;
/** How long a session outlives its page or a play that did not take it. */
export const VOD_PREWARM_GRACE_MS = 5_000;
/** The link must carry the copy by this margin, the engine's own rule for listing the copy. */
const COPY_MARGIN = 1.2;

/** What the player opens the session with; a prewarm is taken only when all of it matches. */
export interface PrewarmChoices {
  audioIndex: number | undefined;
  offsetSeconds: number | undefined;
  subtitleIndex: number | null;
}

interface Prewarm {
  itemId: string;
  choices: PrewarmChoices;
  url: string;
  token: string;
  unsubscribe: () => void;
}

let wanted: string | null = null;
let current: Prewarm | null = null;
let generation = 0;
let dwellTimer: ReturnType<typeof setTimeout> | null = null;
let graceTimer: ReturnType<typeof setTimeout> | null = null;
let watching = false;

function sameChoices(a: PrewarmChoices, b: PrewarmChoices): boolean {
  const offset = (seconds: number | undefined) => (seconds != null && seconds > 0 ? Math.round(seconds * 10) : 0);
  return a.audioIndex === b.audioIndex && offset(a.offsetSeconds) === offset(b.offsetSeconds) && a.subtitleIndex === b.subtitleIndex;
}

function clearTimer(timer: ReturnType<typeof setTimeout> | null): null {
  if (timer) clearTimeout(timer);
  return null;
}

function end(prewarm: Prewarm, why: string): void {
  if (current === prewarm) current = null;
  prewarm.unsubscribe();
  void stopLocalRemux(prewarm.token);
  logger.debug("Prewarm ended", { service: "VodPrewarm", itemId: prewarm.itemId, why });
}

function endLater(why: string): void {
  graceTimer = clearTimer(graceTimer);
  const prewarm = current;
  if (!prewarm) return;
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (current === prewarm) end(prewarm, why);
  }, VOD_PREWARM_GRACE_MS);
}

function watchOnce(): void {
  if (watching) return;
  watching = true;
  onPlaybackHoldTaken(() => endLater("playback started"));
  AppState.addEventListener("change", (state) => {
    if (state !== "active") stopVodPrewarm();
  });
}

/** The choices the player makes for `item` when it opens it from its page: the same helpers, the same order. */
export async function openingChoices(item: JellyfinVideoItem): Promise<PrewarmChoices> {
  const language = await readAudioPreference();
  const audioIndex = preferredAudioStreamIndex(getAudioTracks(item), language) ?? undefined;
  const ticks = item.UserData?.PlaybackPositionTicks;
  const offsetSeconds = resolveResume({ live: false, pendingSeekSec: null, startPositionTicks: ticks, userDataTicks: ticks }).seconds ?? undefined;
  const audioStreams = (item.MediaStreams ?? []).filter((stream) => stream.Type === "Audio");
  const playingAudio = audioStreams.find((stream) => stream.Index === audioIndex) ?? audioStreams.find((stream) => stream.IsDefault === true) ?? audioStreams[0];
  const subtitleIndex = startingSubtitleRendition(getSubtitlePreferenceSync(playingAudio?.Language), sessionSubtitleRenditions(item));
  return { audioIndex, offsetSeconds, subtitleIndex };
}

/** Why `item` gets no prewarm, or null when it does. */
export async function prewarmRefusal(item: JellyfinVideoItem, choices: PrewarmChoices): Promise<string | null> {
  if (item.Type === "TvChannel" || isLiveSource(item) || isAudioItem(item) || playsFromDisk(item.Id)) return "not a streamed video";
  if (!(item.MediaStreams ?? []).some((stream) => stream.Type === "Video")) return "no video";
  if (isPlaybackHeld()) return "playback holds the link";
  if ((await predictPlaybackLane(item)).lane !== "copy") return "not a copy";
  if (offeredTierRungs(item, choices.audioIndex).length === 0) return "no ladder";
  const link = await rememberedBitrate();
  if (link === null || link < sourceBandwidthForItem(item) * COPY_MARGIN) return "link not known to carry the copy";
  return null;
}

async function start(itemId: string, mine: number): Promise<void> {
  const item = await fetchVideoDetails(itemId).catch(() => null);
  if (!item || mine !== generation) return;
  const choices = await openingChoices(item);
  const refusal = await prewarmRefusal(item, choices);
  if (mine !== generation) return;
  if (refusal) {
    logger.debug("No prewarm", { service: "VodPrewarm", itemId, why: refusal });
    return;
  }
  const url = await startLocalRemux(item, choices.audioIndex, choices.offsetSeconds, { prewarm: true, selectedSubtitleIndex: choices.subtitleIndex }).catch(() => null);
  const token = url ? localRemuxToken(url) : null;
  if (!url || !token) return;
  if (mine !== generation) {
    void stopLocalRemux(token);
    return;
  }
  const prewarm: Prewarm = { itemId, choices, url, token, unsubscribe: () => {} };
  prewarm.unsubscribe = subscribeEngineFailure(token, () => end(prewarm, "session failed"));
  current = prewarm;
  logger.info("Prewarm opened", { service: "VodPrewarm", itemId });
}

/** The item page on screen (`itemId`), or none (`null`): its session opens after the dwell and outlives the page by the grace. */
export function prewarmItemPage(itemId: string | null): void {
  watchOnce();
  dwellTimer = clearTimer(dwellTimer);
  generation += 1;
  wanted = itemId;
  if (itemId === null) return endLater("page left");
  graceTimer = clearTimer(graceTimer);
  if (current && current.itemId !== itemId) end(current, "another page");
  if (current) return;
  const mine = generation;
  dwellTimer = setTimeout(() => {
    dwellTimer = null;
    if (wanted === itemId && mine === generation) void start(itemId, mine);
  }, VOD_PREWARM_DWELL_MS);
}

/** The player's open of `itemId`: the prewarm's URL when it was opened the same way, else null. Any other prewarm ends here. */
export function takeVodPrewarm(itemId: string, choices: PrewarmChoices): string | null {
  const prewarm = current;
  if (!prewarm) return null;
  graceTimer = clearTimer(graceTimer);
  if (prewarm.itemId !== itemId || !sameChoices(prewarm.choices, choices)) {
    end(prewarm, "opened another way");
    return null;
  }
  current = null;
  prewarm.unsubscribe();
  attributeSession(prewarm.token, true);
  logger.info("Prewarm taken by the player", { service: "VodPrewarm", itemId });
  return prewarm.url;
}

export function stopVodPrewarm(): void {
  dwellTimer = clearTimer(dwellTimer);
  graceTimer = clearTimer(graceTimer);
  generation += 1;
  wanted = null;
  if (current) end(current, "stopped");
}
