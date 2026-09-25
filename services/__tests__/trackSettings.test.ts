/**
 * The account's audio and subtitle settings, synced through Jellyfin's own user configuration.
 */
import * as SecureStore from "expo-secure-store";

import { STORAGE_KEYS } from "@/services/jellyfin/constants";
import { fetchWithTimeout } from "@/services/jellyfin/http";
import { getCachedConfig, getConfig } from "@/services/jellyfin/session";
import {
  JELLYFIN_DEFAULTS,
  getTrackSettingsSync,
  primeTrackSettings,
  readTrackSettings,
  recordAudioPick,
  recordSubtitlePick,
  refreshTrackSettings,
  resetTrackSettingsForTests,
} from "@/services/jellyfin/trackSettings";

jest.mock("@/services/jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("@/services/jellyfin/events", () => ({ subscribeAuthChange: jest.fn() }));
jest.mock("@/services/jellyfin/session", () => ({ getConfig: jest.fn(), getCachedConfig: jest.fn(), getAuthHeader: jest.fn(() => "MediaBrowser Token") }));
jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() } }));

const fetchMock = fetchWithTimeout as jest.Mock;
const ALICE = { server: "https://jf.example", userId: "alice", deviceId: "dev", apiKey: "key" };
const BOB = { ...ALICE, userId: "bob" };

/** What /Users/Me returns: the four fields plus ones a write must carry through untouched. */
const serverConfiguration = (overrides: Record<string, unknown> = {}) => ({
  AudioLanguagePreference: "",
  PlayDefaultAudioTrack: true,
  SubtitleMode: "Default",
  SubtitleLanguagePreference: "",
  OrderedViews: ["movies", "shows"],
  EnableNextEpisodeAutoPlay: false,
  ...overrides,
});

const respond = (status: number, body?: unknown) => Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });

/** Answers GET /Users/Me with `configuration` and records every POST body. */
function server(configuration: Record<string, unknown>, postStatus = 204) {
  const posts: Record<string, unknown>[] = [];
  fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
    if (init?.method === "POST") {
      posts.push(JSON.parse(init.body ?? "{}"));
      return respond(postStatus);
    }
    return respond(200, { Configuration: configuration });
  });
  return posts;
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve));
};

function signIn(account: typeof ALICE) {
  (getConfig as jest.Mock).mockResolvedValue(account);
  (getCachedConfig as jest.Mock).mockReturnValue(account);
}

beforeEach(async () => {
  jest.clearAllMocks();
  (SecureStore.getItemAsync as jest.Mock).mockResolvedValue(null);
  (SecureStore.setItemAsync as jest.Mock).mockResolvedValue(undefined);
  (SecureStore.deleteItemAsync as jest.Mock).mockResolvedValue(undefined);
  resetTrackSettingsForTests();
  signIn(ALICE);
  await settle();
});

describe("refresh", () => {
  it("adopts what the server holds for the account", async () => {
    server(serverConfiguration({ AudioLanguagePreference: "jpn", PlayDefaultAudioTrack: false, SubtitleMode: "None" }));
    await refreshTrackSettings();
    expect(getTrackSettingsSync()).toEqual({ audioLanguage: "jpn", playDefaultAudio: false, subtitleMode: "None", subtitleLanguage: null });
  });

  it("answers Jellyfin's defaults for an account never read", () => {
    expect(getTrackSettingsSync()).toEqual(JELLYFIN_DEFAULTS);
  });

  it("keeps the last known settings when the server is unreachable", async () => {
    server(serverConfiguration({ SubtitleMode: "None" }));
    await refreshTrackSettings();
    fetchMock.mockRejectedValue(new Error("offline"));
    await refreshTrackSettings();
    expect(getTrackSettingsSync().subtitleMode).toBe("None");
  });

  it("keeps each account's settings apart", async () => {
    server(serverConfiguration({ SubtitleMode: "None" }));
    await refreshTrackSettings();
    signIn(BOB);
    expect(getTrackSettingsSync()).toEqual(JELLYFIN_DEFAULTS);
  });
});

describe("writing a pick", () => {
  it("posts the whole configuration with only the audio fields changed", async () => {
    const posts = server(serverConfiguration());
    recordAudioPick("jpn");
    expect(getTrackSettingsSync()).toMatchObject({ audioLanguage: "jpn", playDefaultAudio: false });
    await settle();
    expect(posts).toEqual([serverConfiguration({ AudioLanguagePreference: "jpn", PlayDefaultAudioTrack: false })]);
    expect(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")?.[0]).toBe("https://jf.example/Users/Configuration?userId=alice");
  });

  it("writes off as SubtitleMode None and a language as Always", async () => {
    const posts = server(serverConfiguration());
    recordSubtitlePick({ kind: "off" });
    await settle();
    recordSubtitlePick({ kind: "language", tag: "eng" });
    await settle();
    expect(posts.map((body) => [body.SubtitleMode, body.SubtitleLanguagePreference])).toEqual([
      ["None", ""],
      ["Always", "eng"],
    ]);
  });

  it("pushes a pick made offline on the next refresh, before adopting anything", async () => {
    fetchMock.mockRejectedValue(new Error("offline"));
    recordAudioPick("jpn");
    await settle();
    const posts = server(serverConfiguration({ AudioLanguagePreference: "eng" }));
    await refreshTrackSettings();
    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({ AudioLanguagePreference: "jpn", PlayDefaultAudioTrack: false });
    expect(getTrackSettingsSync().audioLanguage).toBe("jpn");
  });

  it("keeps the pick on this device when the server refuses the user settings", async () => {
    const posts = server(serverConfiguration(), 403);
    recordAudioPick("jpn");
    await settle();
    recordAudioPick("spa");
    await settle();
    expect(posts).toHaveLength(1);
    expect(getTrackSettingsSync().audioLanguage).toBe("spa");
  });

  it("drops the write when the account switches while it is in flight", async () => {
    const posts = server(serverConfiguration());
    (getConfig as jest.Mock).mockResolvedValueOnce(ALICE).mockResolvedValue(BOB);
    recordAudioPick("jpn");
    await settle();
    expect(posts).toHaveLength(0);
  });

  it("keeps a refused pick through the next refresh and a relaunch", async () => {
    server(serverConfiguration({ AudioLanguagePreference: "eng" }), 403);
    recordAudioPick("jpn");
    await settle();
    await refreshTrackSettings();
    expect(getTrackSettingsSync().audioLanguage).toBe("jpn");
    const onDisk = (SecureStore.setItemAsync as jest.Mock).mock.calls.filter(([key]) => key === STORAGE_KEYS.TRACK_SETTINGS).at(-1)?.[1];
    resetTrackSettingsForTests(true);
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(key === STORAGE_KEYS.TRACK_SETTINGS ? onDisk : null));
    await refreshTrackSettings();
    expect(getTrackSettingsSync().audioLanguage).toBe("jpn");
  });

  it("keeps the demo account's pick through the next refresh", async () => {
    server(serverConfiguration());
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(key === STORAGE_KEYS.IS_DEMO_MODE ? "true" : null));
    recordSubtitlePick({ kind: "off" });
    await settle();
    await refreshTrackSettings();
    expect(getTrackSettingsSync().subtitleMode).toBe("None");
  });

  it("carries a kept pick into the first write the server accepts", async () => {
    const refused = server(serverConfiguration(), 403);
    recordAudioPick("jpn");
    await settle();
    expect(refused).toHaveLength(1);
    const onDisk = (SecureStore.setItemAsync as jest.Mock).mock.calls.filter(([key]) => key === STORAGE_KEYS.TRACK_SETTINGS).at(-1)?.[1];
    resetTrackSettingsForTests(true);
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(key === STORAGE_KEYS.TRACK_SETTINGS ? onDisk : null));
    await primeTrackSettings();
    const posts = server(serverConfiguration());
    recordSubtitlePick({ kind: "off" });
    await settle();
    expect(posts).toEqual([serverConfiguration({ AudioLanguagePreference: "jpn", PlayDefaultAudioTrack: false, SubtitleMode: "None" })]);
    server(serverConfiguration({ AudioLanguagePreference: "spa" }));
    await refreshTrackSettings();
    expect(getTrackSettingsSync().audioLanguage).toBe("spa");
  });

  it("never lets a read that started before a write land over it", async () => {
    let answerFirstRead: (body: unknown) => void = () => undefined;
    const posts: Record<string, unknown>[] = [];
    let reads = 0;
    fetchMock.mockImplementation((url: string, init?: { method?: string; body?: string }) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(init.body ?? "{}"));
        return respond(204);
      }
      reads += 1;
      if (reads === 1) return new Promise((resolve) => (answerFirstRead = (body) => resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })));
      return respond(200, { Configuration: serverConfiguration() });
    });
    const refreshing = refreshTrackSettings();
    await settle();
    recordAudioPick("jpn");
    await settle();
    answerFirstRead({ Configuration: serverConfiguration() });
    await refreshing;
    await settle();
    expect(posts).toHaveLength(1);
    expect(getTrackSettingsSync().audioLanguage).toBe("jpn");
  });

  it("never writes the shared demo account", async () => {
    const posts = server(serverConfiguration());
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(key === STORAGE_KEYS.IS_DEMO_MODE ? "true" : null));
    recordAudioPick("jpn");
    await settle();
    expect(posts).toHaveLength(0);
    expect(getTrackSettingsSync().audioLanguage).toBe("jpn");
  });
});

describe("migration", () => {
  it("hands the old device-wide subtitle choice to an untouched account once", async () => {
    const posts = server(serverConfiguration());
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(key === STORAGE_KEYS.SUBTITLE_PREFERENCE ? "off" : null));
    await refreshTrackSettings();
    await settle();
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(STORAGE_KEYS.SUBTITLE_PREFERENCE);
    expect(posts).toEqual([serverConfiguration({ SubtitleMode: "None" })]);
  });

  it("keeps the old choice for later when the account switches during the migration", async () => {
    const posts = server(serverConfiguration());
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => {
      if (key !== STORAGE_KEYS.SUBTITLE_PREFERENCE) return Promise.resolve(null);
      signIn(BOB);
      return Promise.resolve("off");
    });
    await refreshTrackSettings();
    await settle();
    expect(SecureStore.deleteItemAsync).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });

  it("leaves an account the user already configured alone", async () => {
    const posts = server(serverConfiguration({ SubtitleMode: "Smart", SubtitleLanguagePreference: "eng" }));
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(key === STORAGE_KEYS.SUBTITLE_PREFERENCE ? "off" : null));
    await refreshTrackSettings();
    await settle();
    expect(posts).toHaveLength(0);
    expect(SecureStore.deleteItemAsync).toHaveBeenCalledWith(STORAGE_KEYS.SUBTITLE_PREFERENCE);
  });
});

describe("Keychain", () => {
  const onDisk = JSON.stringify({ "https://jf.example|alice": { settings: { ...JELLYFIN_DEFAULTS, subtitleMode: "None" } } });

  it("answers from the last read on a cold launch, before any server read", async () => {
    resetTrackSettingsForTests(true);
    (SecureStore.getItemAsync as jest.Mock).mockImplementation((key: string) => Promise.resolve(key === STORAGE_KEYS.TRACK_SETTINGS ? onDisk : null));
    await expect(readTrackSettings()).resolves.toMatchObject({ subtitleMode: "None" });
  });

  it("answers the defaults while the Keychain is locked, and retries on the next read", async () => {
    resetTrackSettingsForTests(true);
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error("User interaction is not allowed")).mockResolvedValue(onDisk);
    await primeTrackSettings();
    expect(getTrackSettingsSync()).toEqual(JELLYFIN_DEFAULTS);
    await expect(readTrackSettings()).resolves.toMatchObject({ subtitleMode: "None" });
  });

  it("keeps a refused pick on disk when a new pick lands before the first read", async () => {
    resetTrackSettingsForTests(true);
    const kept = { audioLanguage: "jpn", playDefaultAudio: false };
    const disk = JSON.stringify({ "https://jf.example|alice": { settings: { ...JELLYFIN_DEFAULTS, ...kept }, local: kept } });
    let land: (raw: string) => void = () => undefined;
    (SecureStore.getItemAsync as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    fetchMock.mockRejectedValue(new Error("offline"));
    const reading = primeTrackSettings();
    recordSubtitlePick({ kind: "off" });
    land(disk);
    await reading;
    expect(getTrackSettingsSync()).toMatchObject({ audioLanguage: "jpn", subtitleMode: "None" });
    server(serverConfiguration({ AudioLanguagePreference: "eng" }), 403);
    await refreshTrackSettings();
    await settle();
    expect(getTrackSettingsSync()).toMatchObject({ audioLanguage: "jpn", subtitleMode: "None" });
  });

  it("keeps a pick made before the first read landed", async () => {
    resetTrackSettingsForTests(true);
    let land: (raw: string) => void = () => undefined;
    (SecureStore.getItemAsync as jest.Mock).mockReturnValueOnce(new Promise((resolve) => (land = resolve)));
    fetchMock.mockRejectedValue(new Error("offline"));
    const reading = primeTrackSettings();
    recordAudioPick("jpn");
    land(onDisk);
    await reading;
    expect(getTrackSettingsSync()).toMatchObject({ audioLanguage: "jpn" });
  });
});

describe("readTrackSettings", () => {
  it("waits for a refresh in flight", async () => {
    server(serverConfiguration({ AudioLanguagePreference: "jpn", PlayDefaultAudioTrack: false }));
    void refreshTrackSettings();
    await expect(readTrackSettings()).resolves.toMatchObject({ audioLanguage: "jpn" });
  });

  it("stops waiting on a slow server", async () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    void refreshTrackSettings();
    await expect(readTrackSettings(10)).resolves.toEqual(JELLYFIN_DEFAULTS);
  });
});
