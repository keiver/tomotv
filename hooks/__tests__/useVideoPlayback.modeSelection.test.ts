/**
 * useVideoPlayback.modeSelection.test.ts
 *
 * Tests the playback-mode decision in fetchMetadata (useVideoPlayback.ts,
 * "Determine playback mode" block).
 *
 * This coverage was missing when the local remux engine landed, and that gap
 * shipped the bug it now guards: the remux branch was gated on
 * `requiresTranscoding` alone while the transcode branch below it fired on four
 * conditions. A direct-playable H.264 MP4 carrying a sidecar .srt therefore
 * skipped the engine and went to Jellyfin's SubtitleMethod=Hls path — where
 * every WebVTT segment is stamped X-TIMESTAMP-MAP=MPEGTS:900000 (10s), a map
 * fMP4 segments starting at 0 do not honour, displacing every cue by 10s.
 *
 * The predicates are the real ones from jellyfinApi; only canRemuxLocally
 * (async, native-module backed) is stubbed, matching how the engine's own gates
 * are covered in services/__tests__/localRemux.test.ts.
 *
 * Tests the logic flow with plain variables (no React rendering), following the
 * existing test pattern in this codebase.
 */

import { getBurnInSubtitleStream, getTextSubtitleStreams, isImageBasedSubtitleCodec, needsTranscoding } from "@/services/jellyfinApi";
import type { PlaybackMode } from "../useVideoPlayback";
import type { JellyfinVideoItem } from "@/types/jellyfin";

jest.mock("@/utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

/**
 * Mirrors the mode decision from fetchMetadata. Kept in the same order as the
 * source so a divergence in either is visible here.
 */
function selectMode(
  details: JellyfinVideoItem,
  opts: { audioOnly?: boolean; hasTriedTranscoding?: boolean; remuxEngineAccepts?: boolean; subtitlesOff?: boolean } = {},
): { mode: PlaybackMode; burnInIndex: number | null } {
  const { audioOnly = false, hasTriedTranscoding = false, remuxEngineAccepts = true, subtitlesOff = false } = opts;

  const requiresTranscoding = audioOnly ? false : needsTranscoding(details);
  const textSubtitles = getTextSubtitleStreams(details);
  const hasTextSubs = textSubtitles.length > 0;
  const hasImageSubs = audioOnly ? false : (details.MediaStreams ?? []).some((stream) => stream.Type === "Subtitle" && stream.Index !== undefined && isImageBasedSubtitleCodec(stream.Codec));
  const burnInStream = audioOnly ? null : getBurnInSubtitleStream(details);
  let burnInIndex = burnInStream?.Index ?? null;

  // canRemuxLocally() stands in for the engine's own gates. Image subtitles no
  // longer decline: the engine decodes them and the app draws them, which is
  // asserted in services/__tests__/localRemux.test.ts.
  const canRemuxLocally = remuxEngineAccepts;

  let mode: PlaybackMode = "direct";
  const canRemux = !audioOnly && (requiresTranscoding || hasTextSubs || hasImageSubs) && !hasTriedTranscoding && canRemuxLocally;

  if (canRemux) {
    mode = "localRemux";
    // Nothing is burned in on this lane. Cleared only here, so a fallback to
    // the server still paints the subtitles into the picture.
    burnInIndex = null;
  } else if (requiresTranscoding || hasTextSubs || hasImageSubs || burnInStream !== null || hasTriedTranscoding) {
    mode = "transcode";
    // Jellyfin stamps FORCED=YES and AVKit ignores the rendition entirely, so a
    // file whose text tracks are all forced burns in rather than showing nothing.
    if (burnInIndex === null && hasTextSubs && textSubtitles.every((stream) => stream.IsForced === true) && !subtitlesOff) {
      burnInIndex = textSubtitles[0].Index ?? null;
    }
  }

  return { mode, burnInIndex };
}

const HOUR_IN_TICKS = 36000000000;

/** Direct-playable by codec and container: H.264/AAC in an MP4 container. */
function mp4Item(streams: any[]): JellyfinVideoItem {
  return {
    Id: "item1",
    Name: "Test",
    RunTimeTicks: HOUR_IN_TICKS,
    MediaSources: [{ Id: "item1", Container: "mov,mp4,m4a,3gp,3g2,mj2" }],
    MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }, { Type: "Audio", Codec: "aac", Index: 1 }, ...streams],
  } as JellyfinVideoItem;
}

describe("playback mode selection", () => {
  it("direct-plays an H.264 MP4 with no subtitles", () => {
    expect(selectMode(mp4Item([])).mode).toBe("direct");
  });

  it("remuxes an H.264 MP4 carrying an external sidecar .srt", () => {
    // The regression: any direct-playable MP4 with a sidecar .srt landed here.
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng" }]);

    expect(selectMode(details).mode).toBe("localRemux");
  });

  it("remuxes an H.264 MP4 carrying an embedded text subtitle", () => {
    // Keying the gate on IsExternal alone left this on direct play, where
    // AVPlayer shows nothing unless the codec happens to be mov_text.
    const details = mp4Item([{ Type: "Subtitle", Codec: "ass", IsExternal: false, Index: 2, Language: "eng" }]);

    expect(selectMode(details).mode).toBe("localRemux");
  });

  it("remuxes a file whose only text subtitle is forced, instead of burning it in", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng", IsForced: true }]);
    const result = selectMode(details);

    expect(result.burnInIndex).toBeNull();
    expect(result.mode).toBe("localRemux");
  });

  it("burns a forced-only text subtitle in once the engine declines the file", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng", IsForced: true }]);
    const result = selectMode(details, { remuxEngineAccepts: false });

    expect(result.mode).toBe("transcode");
    expect(result.burnInIndex).toBe(2);
  });

  it("leaves a forced-only text subtitle unburned when the viewer turned subtitles off", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng", IsForced: true }]);
    const result = selectMode(details, { remuxEngineAccepts: false, subtitlesOff: true });

    expect(result.mode).toBe("transcode");
    expect(result.burnInIndex).toBeNull();
  });

  it("leaves a mixed forced and unforced subtitle set alone on the server lane", () => {
    const details = mp4Item([
      { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng", IsForced: true },
      { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 3, Language: "spa" },
    ]);
    const result = selectMode(details, { remuxEngineAccepts: false });

    expect(result.mode).toBe("transcode");
    expect(result.burnInIndex).toBeNull();
  });

  it("remuxes an unsupported container even with no subtitles", () => {
    const details = {
      ...mp4Item([]),
      MediaSources: [{ Id: "item1", Container: "mkv" }],
    } as JellyfinVideoItem;

    expect(selectMode(details).mode).toBe("localRemux");
  });

  // This file direct-played before image subtitles were renderable, and the
  // subtitles simply did not exist. It has to reach the engine now: that is
  // what advertises the track in AVKit's picker and produces the bitmaps.
  it("remuxes a direct-playable file carrying only image subtitles", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "pgssub", IsExternal: false, Index: 2, Language: "eng" }]);
    const result = selectMode(details);

    expect(result.mode).toBe("localRemux");
    expect(result.burnInIndex).toBeNull();
  });

  // Burn-in survives as the fallback: when the engine cannot take the file, the
  // server still paints the subtitles in rather than dropping them.
  it("burns image subtitles in when the engine rejects the file", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "pgssub", IsExternal: false, Index: 2, Language: "eng" }]);
    const result = selectMode(details, { remuxEngineAccepts: false });

    expect(result.mode).toBe("transcode");
    expect(result.burnInIndex).toBe(2);
  });

  it("transcodes when the remux engine rejects the file", () => {
    // Interlaced, 4K/10-bit exotic codec, unremuxable audio: the fallback lane.
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng" }]);

    expect(selectMode(details, { remuxEngineAccepts: false }).mode).toBe("transcode");
  });

  it("transcodes once the retry latch is set, whatever the file looks like", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng" }]);

    expect(selectMode(details, { hasTriedTranscoding: true }).mode).toBe("transcode");
  });

  it("never remuxes an audio-only item", () => {
    const details = {
      Id: "item1",
      Name: "Track",
      RunTimeTicks: HOUR_IN_TICKS,
      MediaSources: [{ Id: "item1", Container: "mp3" }],
      MediaStreams: [{ Type: "Audio", Codec: "mp3", Index: 0 }],
    } as JellyfinVideoItem;

    expect(selectMode(details, { audioOnly: true }).mode).toBe("direct");
  });

  it("keeps the remux gate a superset of every reason the transcode branch fires", () => {
    // The bug in one assertion: anything that leaves direct play, and that the
    // engine accepts, must reach the engine rather than the server.
    const reasons: JellyfinVideoItem[] = [
      { ...mp4Item([]), MediaSources: [{ Id: "item1", Container: "mkv" }] } as JellyfinVideoItem,
      mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2 }]),
      mp4Item([{ Type: "Subtitle", Codec: "mov_text", IsExternal: false, Index: 2 }]),
    ];

    for (const details of reasons) {
      expect(selectMode(details).mode).toBe("localRemux");
    }
  });
});
