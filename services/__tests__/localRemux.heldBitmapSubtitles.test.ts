/**
 * A held conversion's PGS and DVD tracks are files beside it: the rendition hands the engine
 * their paths, which its server-bitmap reader opens with FFmpeg (TierProbeTests covers the read).
 */
const mockImagePath = jest.fn((_id: string, _index: number): string | null => null);

jest.mock("react-native", () => ({
  Platform: { OS: "ios", isTV: false },
  NativeModules: { LocalRemuxer: { startRemux: jest.fn() } },
  NativeEventEmitter: jest.fn(),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/downloads/localSource", () => ({
  localImageSubtitlePath: (id: string, index: number) => mockImagePath(id, index),
  localMediaUri: jest.fn(() => null),
  localSubtitleUri: jest.fn(() => null),
  playsFromDisk: jest.fn(() => true),
}));
jest.mock("@/services/jellyfin/streamUrls", () => ({ getRemoteVideoStreamUrl: jest.fn(), getAudioRenditionUrl: jest.fn(), getTierPlaylistUrl: jest.fn(), getVideoStreamUrl: jest.fn() }));
jest.mock("@/services/jellyfin/bitrateTest", () => ({ rememberedBitrate: jest.fn() }));
jest.mock("@/services/playbackProbe", () => ({ probeEmit: jest.fn(), noteDeviceDecode: jest.fn() }));

import { subtitleRenditions } from "../localRemux";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const converted = {
  Id: "a",
  MediaSources: [{ Id: "a", Container: "mp4" }],
  MediaStreams: [
    { Index: 0, Type: "Video", Codec: "h264" },
    { Index: 1, Type: "Audio", Codec: "aac", Language: "jpn" },
    { Index: 3, Type: "Subtitle", Codec: "DVDSUB", Language: "eng", IsExternal: true },
    { Index: 4, Type: "Subtitle", Codec: "DVDSUB", Language: "fra", IsExternal: true },
  ],
} as unknown as JellyfinVideoItem;

beforeEach(() => mockImagePath.mockReset());

describe("a held conversion's bitmap subtitles", () => {
  it("hands the engine each saved track's path as its bitmap source", () => {
    mockImagePath.mockImplementation((_id, index) => `/doc/downloads/a/sub.${index}.mks`);
    const renditions = subtitleRenditions(converted);
    expect(renditions.map((rendition) => [rendition.index, rendition.isImage, rendition.isExternal, rendition.serverSupUrl])).toEqual([
      [3, true, true, "/doc/downloads/a/sub.3.mks"],
      [4, true, true, "/doc/downloads/a/sub.4.mks"],
    ]);
  });

  it("leaves out a track whose file never landed, and the film plays without it", () => {
    mockImagePath.mockImplementation((_id, index) => (index === 3 ? "/doc/downloads/a/sub.3.mks" : null));
    expect(subtitleRenditions(converted).map((rendition) => rendition.index)).toEqual([3]);
  });
});
