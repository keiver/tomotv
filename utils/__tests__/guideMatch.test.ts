/** Channel to guide pairing in Kodi IPTV Simple's three passes, case ignored, nothing fuzzier. */
import { buildGuideIndex, matchChannels } from "../guideMatch";

const index = buildGuideIndex([
  { id: "CNN.us", displayNames: ["CNN"] },
  { id: "464745", displayNames: ["ABC News Live"] },
  { id: "bbc1", displayNames: ["BBC One HD"] },
  { id: "dup-a", displayNames: ["Local 7"] },
  { id: "dup-b", displayNames: ["Local 7"] },
]);

describe("guide matching", () => {
  it("pairs by tvg-id first, ignoring case", () => {
    expect(matchChannels(index, [{ channelId: "c1", tvgId: "cnn.US", tvgName: "ABC News Live", name: "BBC One HD" }]).get("c1")).toEqual({ guideId: "CNN.us", via: "id" });
  });

  it("then by tvg-name against display-names, as written or with spaces as underscores", () => {
    expect(matchChannels(index, [{ channelId: "c2", tvgId: "Unknown.us", tvgName: "abc news live", name: "x" }]).get("c2")).toEqual({ guideId: "464745", via: "tvgName" });
    expect(matchChannels(index, [{ channelId: "c3", tvgName: "ABC_News_Live", name: "x" }]).get("c3")).toEqual({ guideId: "464745", via: "tvgName" });
  });

  it("then by the channel name, and the first guide channel in file order wins", () => {
    expect(matchChannels(index, [{ channelId: "c4", name: "BBC One HD" }]).get("c4")).toEqual({ guideId: "bbc1", via: "name" });
    expect(matchChannels(index, [{ channelId: "c5", name: "Local 7" }]).get("c5")).toEqual({ guideId: "dup-a", via: "name" });
  });

  it("never strips qualifiers or quality tokens: a name that differs does not pair", () => {
    const misses = matchChannels(index, [
      { channelId: "c6", name: "ABC News Live (720p)" },
      { channelId: "c7", name: "BBC One" },
      { channelId: "c8", tvgId: "CNN.us@SD", name: "CNN International" },
    ]);
    expect(misses.size).toBe(0);
  });
});
