/** What a conversion records, decided at download time from the viewer's track settings. */
const mockAudioLanguage = jest.fn(async (): Promise<string | null> => null);
const mockDevice = jest.fn(() => "en");
type Settings = { audioLanguage: string | null; playDefaultAudio: boolean; subtitleMode: string; subtitleLanguage: string | null };
const mockSettings = jest.fn((): Settings => ({ audioLanguage: null, playDefaultAudio: true, subtitleMode: "Default", subtitleLanguage: null }));

jest.mock("@/services/audioPreference", () => ({
  readAudioPreference: () => mockAudioLanguage(),
  preferredAudioIndexIn: jest.requireActual("@/services/audioPreference").preferredAudioIndexIn,
}));
jest.mock("@/services/i18n", () => ({ deviceLanguage: () => mockDevice() }));
jest.mock("@/services/jellyfin/trackSettings", () => ({ getTrackSettingsSync: () => mockSettings(), recordSubtitlePick: jest.fn(), recordAudioPick: jest.fn(), readTrackSettings: jest.fn() }));

import { conversionTracks } from "@/services/downloads/conversionTracks";
import type { JellyfinVideoItem } from "@/types/jellyfin";

const capture = {
  Id: "c",
  MediaStreams: [
    { Index: 0, Type: "Video", Codec: "mpeg2video" },
    { Index: 1, Type: "Audio", Codec: "mp2", Language: "eng", IsDefault: true },
    { Index: 2, Type: "Audio", Codec: "mp2", Language: "spa" },
    { Index: 3, Type: "Subtitle", Codec: "DVBSUB", Language: "eng" },
  ],
} as unknown as JellyfinVideoItem;

beforeEach(() => {
  mockAudioLanguage.mockResolvedValue(null);
  mockDevice.mockReturnValue("en");
  mockSettings.mockReturnValue({ audioLanguage: null, playDefaultAudio: true, subtitleMode: "Default", subtitleLanguage: null });
});

describe("conversionTracks", () => {
  it("records the audio in the viewer's language and burns the DVB track they would see", async () => {
    mockAudioLanguage.mockResolvedValue("es");
    expect(await conversionTracks(capture)).toEqual({ audioIndex: 2, burnSubtitleIndex: 3 });
  });

  it("burns nothing when the shown track would be none: audio already in the device language", async () => {
    expect(await conversionTracks(capture)).toEqual({});
  });

  it("burns the picked language when subtitles are set to always", async () => {
    mockSettings.mockReturnValue({ audioLanguage: null, playDefaultAudio: true, subtitleMode: "Always", subtitleLanguage: "eng" });
    expect(await conversionTracks(capture)).toEqual({ burnSubtitleIndex: 3 });
  });

  it("burns nothing when subtitles are off", async () => {
    mockAudioLanguage.mockResolvedValue("es");
    mockSettings.mockReturnValue({ audioLanguage: null, playDefaultAudio: true, subtitleMode: "None", subtitleLanguage: null });
    expect(await conversionTracks(capture)).toEqual({ audioIndex: 2 });
  });
});
