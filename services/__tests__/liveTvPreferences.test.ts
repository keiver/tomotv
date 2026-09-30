/** The live TV preferences: defaults, a document read back field by field, favorites and groups by number and name, the filter, the sort's server parameter. */
import {
  activeCategory,
  activeChannelList,
  activePlaylistGroup,
  channelSortParam,
  channelsInList,
  createGroup,
  DEFAULT_LIVE_TV_PREFERENCES,
  deleteGroup,
  getLiveTvPreferences,
  isChannelInGroup,
  isFavoriteChannel,
  LIVE_TV_PREFERENCES_KEY,
  addGuideUrl,
  normalizeGuideUrl,
  removeGuideUrl,
  setGuideSourceEnabled,
  parseLiveTvPreferences,
  renameGroup,
  subscribeLiveTvPreferences,
  toggleChannelInGroup,
  toggleLocalFavoriteChannel,
  updateLiveTvPreferences,
} from "@/services/liveTvPreferences";
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const kqed = { Name: "KQED", ChannelNumber: "9.1" };
const kqedPlus = { Name: "KQED Plus", ChannelNumber: "9.2" };
const unnumbered = { Name: "Al Jazeera English" };

describe("live TV preferences", () => {
  it("reads a document field by field and falls back per field", () => {
    expect(parseLiveTvPreferences(undefined)).toEqual(DEFAULT_LIVE_TV_PREFERENCES);
    expect(parseLiveTvPreferences("{not json")).toEqual(DEFAULT_LIVE_TV_PREFERENCES);
    expect(parseLiveTvPreferences(JSON.stringify({ sort: "name", favorites: [{ number: "9.1", name: "KQED" }, { name: "Al Jazeera English" }, { bogus: true }, null], autoUpdate: "yes" }))).toEqual({
      version: 1,
      autoUpdate: true,
      filter: "all",
      sort: "name",
      favorites: [{ number: "9.1", name: "KQED" }, { name: "Al Jazeera English" }],
      groups: [],
      guideUrls: [],
      guideSourcesOff: [],
      recordingMinutes: 120,
      hideOffline: false,
      compactColumn: false,
    });
    // Guide URLs survive only as http(s), once each; a document from before the list carries one as guideUrl.
    expect(parseLiveTvPreferences({ guideUrls: ["https://g/a.xml", "file:///etc/passwd", 7, "https://g/a.xml", "http://g/b.xml"] }).guideUrls).toEqual(["https://g/a.xml", "http://g/b.xml"]);
    expect(parseLiveTvPreferences({ guideUrl: "https://g/guide.xml.gz" }).guideUrls).toEqual(["https://g/guide.xml.gz"]);
    expect(parseLiveTvPreferences({ guideUrl: "file:///etc/passwd" }).guideUrls).toEqual([]);
    expect(parseLiveTvPreferences({ guideSourcesOff: ["http://g/off.xml", null] }).guideSourcesOff).toEqual(["http://g/off.xml"]);
    // The recording length survives only as a listed option; anything else falls back to 2h.
    expect(parseLiveTvPreferences({ recordingMinutes: 30 }).recordingMinutes).toBe(30);
    expect(parseLiveTvPreferences({ recordingMinutes: 90 }).recordingMinutes).toBe(120);
    expect(parseLiveTvPreferences({ recordingMinutes: "45" }).recordingMinutes).toBe(120);
    // Hide offline survives only as a boolean; anything else falls back to off.
    expect(parseLiveTvPreferences({ hideOffline: true }).hideOffline).toBe(true);
    expect(parseLiveTvPreferences({ hideOffline: "yes" }).hideOffline).toBe(false);
    expect(parseLiveTvPreferences({ compactColumn: true }).compactColumn).toBe(true);
    expect(parseLiveTvPreferences({ compactColumn: 1 }).compactColumn).toBe(false);
  });

  it("reads a favorites-only document from the previous build as the Favorites filter", () => {
    expect(parseLiveTvPreferences({ favoritesOnly: true }).filter).toBe("favorites");
    expect(parseLiveTvPreferences({ favoritesOnly: false }).filter).toBe("all");
    expect(parseLiveTvPreferences({ favoritesOnly: true, filter: "all" }).filter).toBe("all");
  });

  it("drops a filter naming a missing group or an unknown category, and malformed groups", () => {
    const groups = [{ id: "g1", name: "Sports", channels: [{ name: "Red Bull TV" }, { bogus: 1 }] }, { name: "no id" }, null];
    const parsed = parseLiveTvPreferences({ groups, filter: "group:g1" });
    expect(parsed.groups).toEqual([{ id: "g1", name: "Sports", channels: [{ name: "Red Bull TV" }] }]);
    expect(parsed.filter).toBe("group:g1");
    expect(parseLiveTvPreferences({ groups, filter: "group:gone" }).filter).toBe("all");
    expect(parseLiveTvPreferences({ filter: "category:kids" }).filter).toBe("category:kids");
    expect(parseLiveTvPreferences({ filter: "category:weather" }).filter).toBe("all");
    expect(parseLiveTvPreferences({ filter: 7 }).filter).toBe("all");
  });

  it("keeps a playlist filter across restarts and reads its group name back", () => {
    // The groups live on the tuner, not in the document, so any named playlist group is kept.
    expect(parseLiveTvPreferences({ filter: "playlist:News" }).filter).toBe("playlist:News");
    expect(parseLiveTvPreferences({ filter: "playlist:" }).filter).toBe("all");
    expect(activePlaylistGroup("playlist:News & Talk")).toBe("News & Talk");
    expect(activePlaylistGroup("all")).toBeNull();
    expect(activePlaylistGroup("group:g1")).toBeNull();
    expect(activeChannelList({ filter: "playlist:News", favorites: [], groups: [] })).toBeNull();
    expect(activeCategory("playlist:News")).toBeNull();
  });

  it("names a favorite by number and name, or by name alone, and matches channels the same way", () => {
    const stored = parseLiveTvPreferences({ favorites: [{ number: "9.1", name: "KQED" }, { name: "Al Jazeera English" }] });
    expect(isFavoriteChannel(stored, kqed)).toBe(true);
    expect(isFavoriteChannel(stored, kqedPlus)).toBe(false);
    expect(isFavoriteChannel(stored, unnumbered)).toBe(true);
    expect(isFavoriteChannel(stored, { Name: "KQED" })).toBe(false);
    expect(channelsInList(stored.favorites, [kqedPlus, unnumbered, kqed])).toEqual([unnumbered, kqed]);
  });

  it("remembers the id of a channel it lists, and reads an id back, while matching by number and name only", () => {
    toggleLocalFavoriteChannel({ Id: "ch-9", Name: "Nine", ChannelNumber: "9" });
    expect(getLiveTvPreferences().favorites).toContainEqual({ id: "ch-9", number: "9", name: "Nine" });
    expect(isFavoriteChannel(getLiveTvPreferences(), { Id: "other-server-id", Name: "Nine", ChannelNumber: "9" })).toBe(true);
    toggleLocalFavoriteChannel({ Name: "Nine", ChannelNumber: "9" });
    expect(
      parseLiveTvPreferences({
        favorites: [
          { id: "a", name: "A" },
          { id: 3, name: "B" },
        ],
      }).favorites,
    ).toEqual([{ id: "a", name: "A" }, { name: "B" }]);
  });

  it("toggles a favorite, persists the document and tells its subscribers", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeLiveTvPreferences(listener);
    toggleLocalFavoriteChannel(kqed);
    expect(getLiveTvPreferences().favorites).toEqual([{ number: "9.1", name: "KQED" }]);
    expect(JSON.parse(Settings.get(LIVE_TV_PREFERENCES_KEY) as string)).toMatchObject({ version: 1, favorites: [{ number: "9.1", name: "KQED" }] });
    toggleLocalFavoriteChannel(unnumbered);
    toggleLocalFavoriteChannel(kqed);
    expect(getLiveTvPreferences().favorites).toEqual([{ name: "Al Jazeera English" }]);
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    updateLiveTvPreferences({ filter: "favorites", sort: "name" });
    expect(listener).toHaveBeenCalledTimes(3);
    expect(getLiveTvPreferences()).toMatchObject({ filter: "favorites", sort: "name", favorites: [{ name: "Al Jazeera English" }] });
  });

  it("creates, fills, renames and deletes a group; deleting the group on screen shows everything", () => {
    const group = createGroup("  News  ");
    expect(group.name).toBe("News");
    toggleChannelInGroup(group.id, kqed);
    toggleChannelInGroup(group.id, unnumbered);
    let stored = getLiveTvPreferences().groups.find((entry) => entry.id === group.id)!;
    expect(stored.channels).toEqual([{ number: "9.1", name: "KQED" }, { name: "Al Jazeera English" }]);
    expect(isChannelInGroup(stored, kqed)).toBe(true);
    toggleChannelInGroup(group.id, kqed);
    stored = getLiveTvPreferences().groups.find((entry) => entry.id === group.id)!;
    expect(isChannelInGroup(stored, kqed)).toBe(false);

    renameGroup(group.id, "World");
    expect(getLiveTvPreferences().groups.find((entry) => entry.id === group.id)?.name).toBe("World");

    updateLiveTvPreferences({ filter: `group:${group.id}` });
    expect(activeChannelList(getLiveTvPreferences())).toEqual([{ name: "Al Jazeera English" }]);
    deleteGroup(group.id);
    expect(getLiveTvPreferences().groups.some((entry) => entry.id === group.id)).toBe(false);
    expect(getLiveTvPreferences().filter).toBe("all");
  });

  it("reads the list and category a filter holds", () => {
    const stored = parseLiveTvPreferences({ favorites: [{ name: "A" }], groups: [{ id: "g", name: "G", channels: [{ name: "B" }] }] });
    expect(activeChannelList({ ...stored, filter: "all" })).toBeNull();
    expect(activeChannelList({ ...stored, filter: "favorites" })).toEqual([{ name: "A" }]);
    expect(activeChannelList({ ...stored, filter: "group:g" })).toEqual([{ name: "B" }]);
    expect(activeChannelList({ ...stored, filter: "category:news" })).toBeNull();
    expect(activeCategory("category:news")).toBe("news");
    expect(activeCategory("favorites")).toBeNull();
  });

  it("maps the sort to the server's parameter", () => {
    expect(channelSortParam("number")).toBe("SortName");
    expect(channelSortParam("name")).toBe("Name");
  });
});

describe("normalizeGuideUrl", () => {
  it("gives a bare host https so the saved URL survives the next launch's parse", () => {
    expect(normalizeGuideUrl("  iptv-org.github.io/guide.xml ")).toBe("https://iptv-org.github.io/guide.xml");
    expect(parseLiveTvPreferences({ guideUrls: [normalizeGuideUrl("epg.site/x.xml")] }).guideUrls).toEqual(["https://epg.site/x.xml"]);
  });

  it("keeps an explicit scheme and an empty field as typed", () => {
    expect(normalizeGuideUrl("http://lan:8080/guide.xml")).toBe("http://lan:8080/guide.xml");
    expect(normalizeGuideUrl("HTTPS://g/x.xml.gz")).toBe("HTTPS://g/x.xml.gz");
    expect(normalizeGuideUrl("   ")).toBe("");
  });
});

describe("guide URL list", () => {
  beforeEach(() => updateLiveTvPreferences({ guideUrls: [], guideSourcesOff: [] }));

  it("adds a typed URL once, after the others, and refuses one that is not http(s)", () => {
    expect(addGuideUrl("epg.site/a.xml")).toBe("https://epg.site/a.xml");
    expect(addGuideUrl("http://lan/b.xml")).toBe("http://lan/b.xml");
    expect(addGuideUrl("https://epg.site/a.xml")).toBe("https://epg.site/a.xml");
    expect(addGuideUrl("ftp://x/c.xml")).toBeNull();
    expect(addGuideUrl("   ")).toBeNull();
    expect(getLiveTvPreferences().guideUrls).toEqual(["https://epg.site/a.xml", "http://lan/b.xml"]);
  });

  it("switches a guide off and on, and removing one forgets its switch too", () => {
    addGuideUrl("http://lan/b.xml");
    setGuideSourceEnabled("http://lan/b.xml", false);
    setGuideSourceEnabled("http://declared/x.xml", false);
    expect(getLiveTvPreferences().guideSourcesOff).toEqual(["http://lan/b.xml", "http://declared/x.xml"]);
    setGuideSourceEnabled("http://declared/x.xml", true);
    removeGuideUrl("http://lan/b.xml");
    expect(getLiveTvPreferences()).toMatchObject({ guideUrls: [], guideSourcesOff: [] });
  });
});
