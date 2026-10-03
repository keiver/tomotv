/** The flip ring is the list the guide shows for the preferences: favorites and groups by their entries, a playlist group by its ids, otherwise the lineup in the sort's order. */
import { fetchChannelRing } from "../jellyfin/channelRing";
import { fetchChannelOrder, fetchChannelsByIds, fetchListedChannels } from "../jellyfin/liveTv";
import { fetchTunerGroups } from "../jellyfin/tunerGroups";
import { DEFAULT_LIVE_TV_PREFERENCES, type LiveTvPreferences } from "../liveTvPreferences";

jest.mock("../jellyfin/liveTv", () => ({
  fetchChannelOrder: jest.fn(async () => [{ Id: "order" }]),
  fetchChannelsByIds: jest.fn(async () => [{ Id: "byIds" }]),
  fetchListedChannels: jest.fn(async () => [{ Id: "listed" }]),
}));
jest.mock("../jellyfin/tunerGroups", () => ({
  fetchTunerGroups: jest.fn(async () => [{ name: "Sports", channelIds: ["s1", "s2"] }]),
}));

const favorites = [{ name: "News", number: "1" }];
const group = { id: "g1", name: "Kids", channels: [{ name: "Cartoons", number: "7" }] };
const prefs = (patch: Partial<LiveTvPreferences>): LiveTvPreferences => ({ ...DEFAULT_LIVE_TV_PREFERENCES, favorites, groups: [group], ...patch });

describe("fetchChannelRing", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reads the favorites list by its entries", async () => {
    await expect(fetchChannelRing(prefs({ filter: "favorites" }))).resolves.toEqual([{ Id: "listed" }]);
    expect(fetchListedChannels).toHaveBeenCalledWith(favorites);
    expect(fetchChannelOrder).not.toHaveBeenCalled();
  });

  it("reads a named group by its entries", async () => {
    await fetchChannelRing(prefs({ filter: "group:g1" }));
    expect(fetchListedChannels).toHaveBeenCalledWith(group.channels);
  });

  it("reads a playlist group by the tuner's ids, and nothing for a group the tuners no longer name", async () => {
    await expect(fetchChannelRing(prefs({ filter: "playlist:Sports" }))).resolves.toEqual([{ Id: "byIds" }]);
    expect(fetchTunerGroups).toHaveBeenCalledTimes(1);
    expect(fetchChannelsByIds).toHaveBeenCalledWith(["s1", "s2"]);
    await fetchChannelRing(prefs({ filter: "playlist:Gone" }));
    expect(fetchChannelsByIds).toHaveBeenLastCalledWith([]);
  });

  it("reads the lineup in the sort's order, held to the category when one is picked", async () => {
    await expect(fetchChannelRing(prefs({ filter: "all", sort: "number" }))).resolves.toEqual([{ Id: "order" }]);
    expect(fetchChannelOrder).toHaveBeenLastCalledWith({ sortBy: "SortName" });
    await fetchChannelRing(prefs({ filter: "category:news", sort: "name" }));
    expect(fetchChannelOrder).toHaveBeenLastCalledWith({ sortBy: "Name", category: "news" });
    expect(fetchListedChannels).not.toHaveBeenCalled();
    expect(fetchTunerGroups).not.toHaveBeenCalled();
  });
});
