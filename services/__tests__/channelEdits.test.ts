/** The viewer's channel edits at the fetch boundary: hidden channels leave a list, a renamed one shows its name and keeps the server's in SourceName; a hidden id is remembered for programmes. */
import { applyChannelEdits, invalidateChannelListReads, isHiddenChannelId, withChannelEdits } from "@/services/jellyfin/channelEdits";
import { hideChannel, LIVE_TV_PREFERENCES_KEY, renameChannel } from "@/services/liveTvPreferences";
import { cachedRequest } from "@/services/requestCache";
import type { JellyfinItem } from "@/types/jellyfin";
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/session", () => ({ getCachedConfig: jest.fn(() => ({ server: "", apiKey: "", userId: "", deviceId: "" })) }));

const kqed = { Id: "c1", Name: "KQED", Type: "TvChannel", ChannelNumber: "9.1", Path: "" } as JellyfinItem;
const aje = { Id: "c2", Name: "Al Jazeera English", Type: "TvChannel", Path: "" } as JellyfinItem;
const program = { Id: "p1", Name: "News", Type: "Program", ChannelId: "c1", Path: "" } as JellyfinItem;

beforeEach(() => Settings.set({ [LIVE_TV_PREFERENCES_KEY]: undefined }));

describe("applyChannelEdits", () => {
  it("returns the list as it is with nothing hidden or renamed", () => {
    expect(applyChannelEdits([kqed, aje, program])).toEqual([kqed, aje, program]);
  });

  it("drops hidden channels, remembers their ids, and leaves programmes to the caller", () => {
    hideChannel(kqed);
    expect(applyChannelEdits([kqed, aje, program])).toEqual([aje, program]);
    expect(isHiddenChannelId("c1")).toBe(true);
    expect(isHiddenChannelId("c2")).toBe(false);
    // The same channel under another id on another server hides by its number and name.
    expect(applyChannelEdits([{ ...kqed, Id: "other" }])).toEqual([]);
  });

  it("shows a renamed channel under its name and keeps the server's name for the lists", () => {
    renameChannel(aje, "AJE");
    const [shown] = applyChannelEdits([aje]);
    expect(shown).toEqual({ ...aje, Name: "AJE", SourceName: "Al Jazeera English" });
    // Applying the edits again to an edited channel changes nothing.
    expect(applyChannelEdits([shown])).toEqual([shown]);
    expect(withChannelEdits(shown)).toBe(shown);
  });

  it("puts the server's name back on a channel whose rename was removed", () => {
    renameChannel(aje, "AJE");
    const [shown] = applyChannelEdits([aje]);
    renameChannel(aje, "");
    expect(withChannelEdits(shown)).toEqual(aje);
    expect(withChannelEdits(program)).toBe(program);
  });
});

describe("invalidateChannelListReads", () => {
  it("drops the guide's channel pages and the search's lineup, nothing else", async () => {
    const fresh = jest.fn(async () => "x");
    for (const key of ["guide:channels:page:SortName:all:0", "liveChannelNames:http://jf:u", "guide:horizon", "liveAiring:u"]) await cachedRequest(key, fresh, 60_000);
    invalidateChannelListReads();
    for (const key of ["guide:channels:page:SortName:all:0", "liveChannelNames:http://jf:u", "guide:horizon", "liveAiring:u"]) await cachedRequest(key, fresh, 60_000);
    expect(fresh).toHaveBeenCalledTimes(6);
  });
});
