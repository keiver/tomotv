/**
 * Which lane plays this item: direct play, the on-device engine, or the server's transcode.
 *
 * Pure, and split in two because the caller has to await between the halves: the gates say
 * what to ask the engine and the verdict store, the lane pick reads their answers back.
 */
import type { VideoDecodeSupport } from "@/constants/codecs";
// Through the barrel, like every other player call site: tests stand their fixtures up there.
import { audioNeedsRewrap, getBurnInSubtitleStream, getTextSubtitleStreams, isAudioOnly, isImageBasedSubtitleCodec, isLiveSource, needsTranscoding } from "@/services/jellyfinApi";
import type { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";
import type { PlaybackMode } from "./machine";

export interface LaneGatesInput {
  details: JellyfinVideoItem;
  /** What this device's decoders answer for; null while unknown. */
  decodeSupport: VideoDecodeSupport | null;
  /** The link this server measured, or null when the memory is cold. */
  measuredBps: number | null;
  /** A download of this item is on disk. */
  heldOnDisk: boolean;
  /** That download was rewrapped to MP4, so its container is ours, not the metadata's. */
  heldAsMp4: boolean;
  /** Direct play already errored for this item. */
  directPlayFailed: boolean;
  hasTriedTranscoding: boolean;
  /** The engine lane is spent for this held item, so subtitles stop being a reason to reach it. */
  heldEngineSpent: boolean;
  /** Which rung a live channel is on. */
  liveLane: "engine" | "server";
}

export interface LaneGates {
  live: boolean;
  audioOnly: boolean;
  heldOnDisk: boolean;
  heldAsMp4: boolean;
  requiresTranscoding: boolean;
  textSubtitles: JellyfinMediaStream[];
  hasTextSubs: boolean;
  hasImageSubs: boolean;
  burnInStream: JellyfinMediaStream | null;
  /** Any subtitle stream at all, text or image; the stale-report guard in onTextTracks reads it. */
  itemHasSubtitleStreams: boolean;
  linkTooSlowForDirect: boolean;
  sourceBps: number;
  cannotDirectPlay: boolean;
  leavesDirectPlay: boolean;
  liveServerUrl: string | null;
  liveWantsServer: boolean;
  liveLane: "engine" | "server";
  /** The open handed the engine a stream to read. */
  hasLiveStreamUrl: boolean;
  /** Ask engineVerdicts whether this device already measured the file below realtime. */
  asksRememberedVerdict: boolean;
  /** Every sync term of the engine gate; the caller ANDs the remembered verdict and canRemuxLocally. */
  engineGate: boolean;
}

/**
 * A file that cannot direct-play, whose video AVPlayer can decode, is rewrapped on-device
 * instead. The gate must mirror EVERY reason the lane pick leaves direct play, or a file
 * goes to the server for a reason the engine could have handled (a sidecar .srt did, and
 * Jellyfin's 10s X-TIMESTAMP-MAP displaced every cue).
 */
export function planLaneGates(input: LaneGatesInput): LaneGates {
  const { details, heldOnDisk, heldAsMp4 } = input;
  const live = isLiveSource(details);
  const audioOnly = isAudioOnly(details);

  // Audio-only is not "always direct-plays": Vorbis in Ogg, APE and TTA all need the rewrap.
  const requiresTranscoding = audioOnly ? audioNeedsRewrap(details) : needsTranscoding(details, input.decodeSupport);

  // Text subtitles (sidecars AND embedded). AVPlayer needs them as HLS renditions, which
  // only the remux and transcode paths build.
  const textSubtitles = getTextSubtitleStreams(details);
  const hasTextSubs = textSubtitles.length > 0;
  // Image tracks (PGS, DVD/VobSub, DVB, XSUB): the engine decodes them to the bitmaps the app
  // draws, so they are a reason to REACH the engine rather than to avoid it.
  const hasImageSubs = audioOnly ? false : (details.MediaStreams ?? []).some((stream) => stream.Type === "Subtitle" && stream.Index !== undefined && isImageBasedSubtitleCodec(stream.Codec));
  const burnInStream = audioOnly ? null : getBurnInSubtitleStream(details);

  // A link measurably slower than the file starves direct play, which has no cushion and no
  // recovery of its own. RAW comparison, like Jellyfin's own IsBitrateLimitExceeded: a 0.7
  // trust factor called a 5.5 Mbps link carrying a 4.4 Mbps file too slow. A held file is read
  // off the disk, so the link describes nothing about the session.
  const sourceBps = details.MediaSources?.[0]?.Bitrate ?? 0;
  const measurable = sourceBps > 0 && !live && !heldOnDisk;
  const linkTooSlowForDirect = measurable && input.measuredBps != null && input.measuredBps < sourceBps;

  // The only reasons that may END at the server, because that rung re-encodes the whole film.
  // A repackaged file drops the codec test: the MP4 this app wrote is what opens.
  const cannotDirectPlay = heldAsMp4 ? input.directPlayFailed || input.hasTriedTranscoding : requiresTranscoding || input.directPlayFailed || input.hasTriedTranscoding || linkTooSlowForDirect;

  // Why the engine is worth reaching for, and never a reason to reach the server: a subtitle
  // track is not worth re-encoding a film over. Inside a held file text tracks are mov_text,
  // which AVPlayer draws itself, so only a sidecar needs the engine to attach it.
  const heldNeedsEngineForSubs = hasImageSubs || textSubtitles.some((stream) => stream.IsExternal === true);
  const subtitlesWantEngine = !heldAsMp4 && !input.heldEngineSpent && (heldOnDisk ? heldNeedsEngineForSubs : hasImageSubs || hasTextSubs);

  const leavesDirectPlay = live || cannotDirectPlay || subtitlesWantEngine;

  // A live channel takes the server's transcode once the engine is spent on it, or when the
  // open gave the engine nothing to read.
  const liveServerUrl = live ? (details.liveTranscodeUrl ?? null) : null;
  const liveWantsServer = liveServerUrl !== null && (input.liveLane === "server" || !details.liveStreamUrl);

  return {
    live,
    audioOnly,
    heldOnDisk,
    heldAsMp4,
    requiresTranscoding,
    textSubtitles,
    hasTextSubs,
    hasImageSubs,
    burnInStream,
    itemHasSubtitleStreams: !audioOnly && (hasTextSubs || hasImageSubs),
    linkTooSlowForDirect,
    sourceBps,
    cannotDirectPlay,
    leavesDirectPlay,
    liveServerUrl,
    liveWantsServer,
    liveLane: input.liveLane,
    hasLiveStreamUrl: Boolean(details.liveStreamUrl),
    // A held file is exempt: sending a download to the server is what it was taken to avoid.
    asksRememberedVerdict: leavesDirectPlay && !live && !input.hasTriedTranscoding && !heldOnDisk,
    engineGate: leavesDirectPlay && !liveWantsServer && (live || !input.hasTriedTranscoding) && !input.heldEngineSpent,
  };
}

export interface LanePickInput {
  /** The engine takes this file: engineGate, no remembered decline, and canRemuxLocally agreed. */
  canRemux: boolean;
  /** The viewer turned subtitles off, so nothing may be burned into the picture. */
  subtitlesOff: boolean;
}

export interface LaneDecision {
  mode: PlaybackMode;
  /** Image (or forced-text) stream the server paints into the picture; null on every other lane. */
  burnInSubtitleIndex: number | null;
  /** Neither lane can play this channel; the caller throws with this. */
  unplayable: string | null;
  /** Live only: why the channel left the engine, for the log and the probe. */
  liveFallbackReason: string | null;
}

export function selectLane(gates: LaneGates, input: LanePickInput): LaneDecision {
  const burnInFromStream = gates.burnInStream?.Index ?? null;

  if (input.canRemux) {
    // The engine draws these itself. Cleared only here, so a fallback to the server keeps its
    // burn-in.
    return { mode: "localRemux", burnInSubtitleIndex: null, unplayable: null, liveFallbackReason: null };
  }

  if (gates.live) {
    if (!gates.liveServerUrl) {
      return { mode: "transcode", burnInSubtitleIndex: burnInFromStream, unplayable: "live channel cannot reach the engine and the server offers no transcode", liveFallbackReason: null };
    }
    return {
      mode: "transcode",
      burnInSubtitleIndex: burnInFromStream,
      unplayable: null,
      liveFallbackReason: gates.liveLane === "server" ? "engine spent on this channel" : gates.hasLiveStreamUrl ? "engine cannot take the stream" : "the open gave the engine nothing to read",
    };
  }

  if (!gates.cannotDirectPlay) {
    return { mode: "direct", burnInSubtitleIndex: burnInFromStream, unplayable: null, liveFallbackReason: null };
  }

  // Jellyfin stamps FORCED=YES straight from the source flag and AVKit neither lists nor applies
  // a rendition carrying it (T05), so a file whose text tracks are ALL forced burns them in
  // rather than playing with nothing on screen. Never when subtitles are off: burn-in cannot be
  // switched back off.
  const forcedOnly = burnInFromStream === null && gates.hasTextSubs && gates.textSubtitles.every((stream) => stream.IsForced === true) && !input.subtitlesOff;
  return {
    mode: "transcode",
    burnInSubtitleIndex: forcedOnly ? (gates.textSubtitles[0].Index ?? null) : burnInFromStream,
    unplayable: null,
    liveFallbackReason: null,
  };
}
