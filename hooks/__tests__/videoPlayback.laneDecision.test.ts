/**
 * The lane pick that fetchMetadata runs: direct play, the on-device engine, or the server.
 *
 * Drives the real planLaneGates/selectLane with the real jellyfinApi predicates; only the
 * engine's own accept (async, native-backed) is passed in, as it is at the call site.
 */
import { planLaneGates, selectLane, type LaneGatesInput } from "../videoPlayback/laneDecision";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import type { PlaybackMode } from "../videoPlayback/machine";

jest.mock("@/utils/logger", () => ({
  logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const HOUR_IN_TICKS = 36000000000;

type Options = Partial<Omit<LaneGatesInput, "details">> & { engineAccepts?: boolean; subtitlesOff?: boolean };

function pick(details: JellyfinVideoItem, options: Options = {}): { mode: PlaybackMode; burnInIndex: number | null; unplayable: string | null } {
  const { engineAccepts = true, subtitlesOff = false, ...gateInput } = options;
  const gates = planLaneGates({
    details,
    decodeSupport: null,
    measuredBps: null,
    heldOnDisk: false,
    heldAsMp4: false,
    directPlayFailed: false,
    hasTriedTranscoding: false,
    heldEngineSpent: false,
    liveLane: "engine",
    ...gateInput,
  });
  const lane = selectLane(gates, { canRemux: gates.engineGate && engineAccepts, subtitlesOff });
  return { mode: lane.mode, burnInIndex: lane.burnInSubtitleIndex, unplayable: lane.unplayable };
}

/** Direct-playable by codec and container: H.264/AAC in an MP4 container. */
function mp4Item(streams: unknown[]): JellyfinVideoItem {
  return {
    Id: "item1",
    Name: "Test",
    RunTimeTicks: HOUR_IN_TICKS,
    MediaSources: [{ Id: "item1", Container: "mov,mp4,m4a,3gp,3g2,mj2" }],
    MediaStreams: [{ Type: "Video", Codec: "h264", Index: 0 }, { Type: "Audio", Codec: "aac", Index: 1 }, ...streams],
  } as JellyfinVideoItem;
}

const mkvItem = (streams: unknown[] = []) => ({ ...mp4Item(streams), MediaSources: [{ Id: "item1", Container: "mkv" }] }) as JellyfinVideoItem;

const audioItem = (codec: string, container: string): JellyfinVideoItem =>
  ({
    Id: "item1",
    Name: "Track",
    RunTimeTicks: HOUR_IN_TICKS,
    MediaSources: [{ Id: "item1", Container: container }],
    MediaStreams: [{ Type: "Audio", Codec: codec, Index: 0 }],
  }) as JellyfinVideoItem;

describe("lane selection", () => {
  it("direct-plays an H.264 MP4 with no subtitles", () => {
    expect(pick(mp4Item([])).mode).toBe("direct");
  });

  it("remuxes an H.264 MP4 carrying an external sidecar .srt", () => {
    // The regression this gate exists for: Jellyfin's WebVTT carries a 10s X-TIMESTAMP-MAP
    // that fMP4 segments starting at 0 do not honour.
    expect(pick(mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng" }])).mode).toBe("localRemux");
  });

  it("remuxes an H.264 MP4 carrying an embedded text subtitle", () => {
    expect(pick(mp4Item([{ Type: "Subtitle", Codec: "ass", IsExternal: false, Index: 2, Language: "eng" }])).mode).toBe("localRemux");
  });

  it("remuxes an unsupported container even with no subtitles", () => {
    expect(pick(mkvItem()).mode).toBe("localRemux");
  });

  it("remuxes a direct-playable file carrying only image subtitles, and burns nothing in", () => {
    const result = pick(mp4Item([{ Type: "Subtitle", Codec: "pgssub", IsExternal: false, Index: 2, Language: "eng" }]));
    expect(result).toMatchObject({ mode: "localRemux", burnInIndex: null });
  });

  it("remuxes a forced-only text subtitle file instead of burning it in", () => {
    const details = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, Language: "eng", IsForced: true }]);
    expect(pick(details)).toMatchObject({ mode: "localRemux", burnInIndex: null });
  });

  it("keeps the engine gate a superset of every reason the transcode branch fires", () => {
    const reasons = [mkvItem(), mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2 }]), mp4Item([{ Type: "Subtitle", Codec: "mov_text", IsExternal: false, Index: 2 }])];
    for (const details of reasons) expect(pick(details).mode).toBe("localRemux");
  });

  describe("when the engine declines", () => {
    const declined = { engineAccepts: false };

    it.each([
      ["a forced-only subtitle file", mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, IsForced: true }])],
      [
        "a mixed forced and unforced set",
        mp4Item([
          { Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, IsForced: true },
          { Type: "Subtitle", Codec: "subrip", Index: 3 },
        ]),
      ],
      ["a file with image subtitles", mp4Item([{ Type: "Subtitle", Codec: "pgssub", Index: 2 }])],
    ])("plays %s as it stands: a subtitle never buys a re-encode", (_label, details) => {
      expect(pick(details, declined).mode).toBe("direct");
    });

    it("transcodes a file AVPlayer cannot open either", () => {
      expect(pick(mkvItem([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2 }]), declined).mode).toBe("transcode");
    });

    it("burns in a forced-only set on the server lane, where AVKit would list nothing", () => {
      expect(pick(mkvItem([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, IsForced: true }]), declined)).toMatchObject({ mode: "transcode", burnInIndex: 2 });
    });

    it("burns nothing in when the viewer turned subtitles off", () => {
      expect(pick(mkvItem([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2, IsForced: true }]), { ...declined, subtitlesOff: true })).toMatchObject({ burnInIndex: null });
    });
  });

  it("transcodes once the retry latch is set, whatever the file looks like", () => {
    expect(pick(mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2 }]), { hasTriedTranscoding: true }).mode).toBe("transcode");
  });

  it("tries the engine when direct play failed on a file that looked direct-playable", () => {
    expect(pick(mp4Item([]), { directPlayFailed: true }).mode).toBe("localRemux");
  });

  it("falls to the server, never back to direct play, when the engine also declines", () => {
    expect(pick(mp4Item([]), { directPlayFailed: true, engineAccepts: false }).mode).toBe("transcode");
  });

  describe("audio-only", () => {
    it("direct-plays a file AVPlayer can open", () => {
      expect(pick(audioItem("mp3", "mp3")).mode).toBe("direct");
    });

    it("remuxes Vorbis in Ogg rather than asking a server to re-encode it", () => {
      expect(pick(audioItem("vorbis", "ogg")).mode).toBe("localRemux");
    });

    it("sends it to the server when the engine will not take it", () => {
      expect(pick(audioItem("vorbis", "ogg"), { engineAccepts: false }).mode).toBe("transcode");
    });
  });

  describe("the link", () => {
    /** A direct-playable 4.4 Mb/s source, so the measured link is the only thing deciding. */
    const source = () => ({ ...mp4Item([]), MediaSources: [{ Id: "item1", Container: "mov,mp4,m4a,3gp,3g2,mj2", Bitrate: 4_400_000 }] }) as JellyfinVideoItem;

    it("routes a direct-playable file off direct play when it measures under the source", () => {
      expect(pick(source(), { measuredBps: 2_000_000 }).mode).toBe("localRemux");
    });

    it("keeps direct play when it carries the source, with no trust factor shaved off", () => {
      // A 0.7 factor called a 5.5 Mb/s link carrying a 4.4 Mb/s file too slow.
      expect(pick(source(), { measuredBps: 5_500_000 }).mode).toBe("direct");
    });

    it("says nothing about a file read off this device's own disk", () => {
      expect(pick(source(), { measuredBps: 2_000_000, heldOnDisk: true, heldAsMp4: true }).mode).toBe("direct");
    });
  });

  describe("held files", () => {
    const withSidecar = mp4Item([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2 }]);
    const withEmbedded = mp4Item([{ Type: "Subtitle", Codec: "mov_text", IsExternal: false, Index: 2 }]);

    it("reaches the engine for a sidecar saved beside the media", () => {
      expect(pick(withSidecar, { heldOnDisk: true }).mode).toBe("localRemux");
    });

    it("direct-plays embedded text, which AVPlayer draws itself", () => {
      expect(pick(withEmbedded, { heldOnDisk: true }).mode).toBe("direct");
    });

    it("drops the subtitle ask once the engine is spent: the film outranks the subtitle", () => {
      expect(pick(withSidecar, { heldOnDisk: true, heldEngineSpent: true }).mode).toBe("direct");
    });

    it("reads the repackaged MP4, not the container the metadata still names", () => {
      expect(pick(mkvItem([{ Type: "Subtitle", Codec: "subrip", IsExternal: true, Index: 2 }]), { heldOnDisk: true, heldAsMp4: true }).mode).toBe("direct");
    });
  });

  describe("live channels", () => {
    // isLiveSource keys on the opened stream, not the item type.
    const channel = (extra: Partial<JellyfinVideoItem>) =>
      ({ Id: "ch1", Name: "Channel", Type: "TvChannel", MediaSources: [{ Id: "ch1", IsInfiniteStream: true }], MediaStreams: [], ...extra }) as JellyfinVideoItem;

    it("takes the engine when the open gave it a stream to read", () => {
      expect(pick(channel({ liveStreamUrl: "http://origin/live.ts" })).mode).toBe("localRemux");
    });

    it("takes the server's transcode once the engine is spent on the channel", () => {
      const result = pick(channel({ liveStreamUrl: "http://origin/live.ts", liveTranscodeUrl: "http://server/live.m3u8" }), { liveLane: "server" });
      expect(result.mode).toBe("transcode");
    });

    it("refuses a channel neither lane can play rather than picking one", () => {
      expect(pick(channel({}), { engineAccepts: false }).unplayable).toMatch(/cannot reach the engine/);
    });
  });
});
