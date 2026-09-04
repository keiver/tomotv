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

import { audioNeedsRewrap, getBurnInSubtitleStream, getTextSubtitleStreams, isImageBasedSubtitleCodec, needsTranscoding } from "@/services/jellyfinApi";
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
  opts: { audioOnly?: boolean; hasTriedTranscoding?: boolean; remuxEngineAccepts?: boolean; subtitlesOff?: boolean; directPlayFailed?: boolean } = {},
): { mode: PlaybackMode; burnInIndex: number | null } {
  const { audioOnly = false, hasTriedTranscoding = false, remuxEngineAccepts = true, subtitlesOff = false, directPlayFailed = false } = opts;

  const requiresTranscoding = audioOnly ? audioNeedsRewrap(details) : needsTranscoding(details);
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
  const canRemux = (requiresTranscoding || hasTextSubs || hasImageSubs || directPlayFailed) && !hasTriedTranscoding && canRemuxLocally;

  // Mirrors the hook: only these may end at the server. Subtitles are a reason to reach the
  // engine and never a reason to re-encode a film, so they are not in this set.
  const cannotDirectPlay = requiresTranscoding || hasTriedTranscoding || directPlayFailed;

  if (canRemux) {
    mode = "localRemux";
    // Nothing is burned in on this lane. Cleared only here, so a fallback to
    // the server still paints the subtitles into the picture.
    burnInIndex = null;
  } else if (cannotDirectPlay) {
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

  // A file AVPlayer opens as it stands plays as it stands. Burning the track in means
  // re-encoding the whole film, which is not a price a subtitle gets to set.
  it("plays a forced-only text subtitle file as it is once the engine declines it", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng", IsForced: true }]);

    expect(selectMode(details, { remuxEngineAccepts: false }).mode).toBe("direct");
  });

  it("plays a mixed forced and unforced set as it is once the engine declines it", () => {
    const details = mp4Item([
      { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng", IsForced: true },
      { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 3, Language: "spa" },
    ]);

    expect(selectMode(details, { remuxEngineAccepts: false }).mode).toBe("direct");
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

  // The engine is what draws these, so a decline costs the bitmaps. It does not cost the
  // film: the alternative was re-encoding a 4K source to paint a subtitle onto it.
  it("plays a file with image subtitles as it is when the engine rejects it", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "pgssub", IsExternal: false, Index: 2, Language: "eng" }]);

    expect(selectMode(details, { remuxEngineAccepts: false }).mode).toBe("direct");
  });

  it("transcodes when the engine rejects a file AVPlayer cannot open either", () => {
    const details = {
      ...mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng" }]),
      MediaSources: [{ Id: "item1", Container: "mkv" }],
    } as JellyfinVideoItem;

    expect(selectMode(details, { remuxEngineAccepts: false }).mode).toBe("transcode");
  });

  it("transcodes once the retry latch is set, whatever the file looks like", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng" }]);

    expect(selectMode(details, { hasTriedTranscoding: true }).mode).toBe("transcode");
  });

  const audioItem = (codec: string, container: string): JellyfinVideoItem =>
    ({
      Id: "item1",
      Name: "Track",
      RunTimeTicks: HOUR_IN_TICKS,
      MediaSources: [{ Id: "item1", Container: container }],
      MediaStreams: [{ Type: "Audio", Codec: codec, Index: 0 }],
    }) as JellyfinVideoItem;

  it("direct-plays an audio file AVPlayer can open", () => {
    expect(selectMode(audioItem("mp3", "mp3"), { audioOnly: true }).mode).toBe("direct");
  });

  it("remuxes an audio file AVPlayer cannot open", () => {
    // Vorbis in Ogg. This used to direct-play, fail on the device and land on
    // the server, re-encoding a music file the engine can simply rewrap.
    expect(selectMode(audioItem("vorbis", "ogg"), { audioOnly: true }).mode).toBe("localRemux");
  });

  it("sends an audio file to the server when the engine will not take it", () => {
    expect(selectMode(audioItem("vorbis", "ogg"), { audioOnly: true, remuxEngineAccepts: false }).mode).toBe("transcode");
  });

  it("tries the engine when direct play failed on a file that looked direct-playable", () => {
    // Codec and container both pass inspection, so whatever AVPlayer objected
    // to is in the wrapper — which is the one thing rewrapping fixes.
    expect(selectMode(mp4Item([]), { directPlayFailed: true }).mode).toBe("localRemux");
  });

  it("falls to the server, never back to direct play, when the engine also declines", () => {
    // The loop guard: without directPlayFailed in the transcode condition this
    // returns "direct" and the same failure repeats forever.
    expect(selectMode(mp4Item([]), { directPlayFailed: true, remuxEngineAccepts: false }).mode).toBe("transcode");
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
