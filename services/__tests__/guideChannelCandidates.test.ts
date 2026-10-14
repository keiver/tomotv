/** The channel list a guide keeps programmes for: every channel the server and the tuner playlists carry, under every name a screen asks by. */
import { guideChannelCandidates } from "../jellyfin/search";
import { clearRequestCache } from "../requestCache";

jest.mock("../jellyfin/http", () => ({ fetchWithTimeout: jest.fn() }));
jest.mock("../jellyfin/session", () => ({
  getConfig: jest.fn(async () => ({ server: "http://jf", apiKey: "k", userId: "u", deviceId: "d" })),
  getAuthHeader: jest.fn(() => "auth"),
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("../jellyfin/tunerGroups", () => ({ fetchTunerData: jest.fn(), guideChannelRequests: jest.requireActual("../jellyfin/tunerGroups").guideChannelRequests }));
jest.mock("../jellyfin/liveTv", () => ({ ...jest.requireActual("../jellyfin/liveTv"), fetchChannelOrder: jest.fn() }));
jest.mock("@keiver/tomo-live", () => ({
  ...jest.requireActual("@keiver/tomo-live"),
  allPlaylistChannelIds: jest.fn(() => []),
  playlistChannelById: jest.fn(() => null),
}));

const { fetchTunerData } = jest.requireMock("../jellyfin/tunerGroups") as { fetchTunerData: jest.Mock };
const { fetchChannelOrder } = jest.requireMock("../jellyfin/liveTv") as { fetchChannelOrder: jest.Mock };
const tomoLive = jest.requireMock("@keiver/tomo-live") as { allPlaylistChannelIds: jest.Mock; playlistChannelById: jest.Mock };

describe("guideChannelCandidates", () => {
  beforeEach(() => {
    clearRequestCache();
    jest.clearAllMocks();
    tomoLive.allPlaylistChannelIds.mockReturnValue([]);
    tomoLive.playlistChannelById.mockReturnValue(null);
  });

  it("lists server and playlist channels with their tvg keys and every name a screen asks by", async () => {
    fetchChannelOrder.mockResolvedValue([{ Id: "s1", Name: "News One" }]);
    fetchTunerData.mockResolvedValue({ tvgById: { s1: "news.us", p1: "late.us" }, tvgNameById: { p1: "Late_Show" } });
    tomoLive.allPlaylistChannelIds.mockReturnValue(["p1"]);
    tomoLive.playlistChannelById.mockImplementation((id: string) => (id === "p1" ? { name: "Late Show" } : null));
    await expect(guideChannelCandidates()).resolves.toEqual([
      { channelId: "s1", tvgId: "news.us", tvgName: undefined, names: ["News One"] },
      { channelId: "p1", tvgId: "late.us", tvgName: "Late_Show", names: ["Late Show", "Late_Show"] },
    ]);
  });

  it("still lists the server's channels by name when the tuner read fails", async () => {
    fetchChannelOrder.mockResolvedValue([{ Id: "s1", Name: "News One" }]);
    fetchTunerData.mockRejectedValue(new Error("tuner down"));
    await expect(guideChannelCandidates()).resolves.toEqual([{ channelId: "s1", tvgId: undefined, tvgName: undefined, names: ["News One"] }]);
  });

  it("answers null when the lineup cannot be read, so a guide keeps every channel", async () => {
    fetchChannelOrder.mockRejectedValue(new Error("server down"));
    fetchTunerData.mockResolvedValue({ tvgById: {}, tvgNameById: {} });
    await expect(guideChannelCandidates()).resolves.toBeNull();
  });
});
