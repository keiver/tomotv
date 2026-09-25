/** The filter strip's choices: Favorites, All, custom groups, playlist groups, categories. */
import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

let mockPreferences: { favorites: { name: string }[]; groups: { id: string; name: string; channels: [] }[]; filter: string };
let mockCategories: string[] = [];
let mockTunerGroups: { name: string; channelIds: string[] }[] | null = null;

jest.mock("@/hooks/useLiveTvPreferences", () => ({ useLiveTvPreferences: () => mockPreferences }));
jest.mock("@/hooks/useLiveTvCategories", () => ({ useLiveTvCategories: () => mockCategories }));
jest.mock("@/hooks/useTunerGroups", () => ({ useTunerGroups: () => mockTunerGroups }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

type Choices = ReturnType<typeof useChannelFilterChoices>;
type HookRef = { get: () => Choices };

const Harness = forwardRef<HookRef>((_props, ref) => {
  const choices = useChannelFilterChoices();
  useImperativeHandle(ref, () => ({ get: () => choices }), [choices]);
  return null;
});
Harness.displayName = "Harness";

function render(): Choices {
  const ref = React.createRef<HookRef>();
  act(() => {
    TestRenderer.create(<Harness ref={ref} />);
  });
  return ref.current!.get();
}

describe("useChannelFilterChoices", () => {
  beforeEach(() => {
    mockPreferences = { favorites: [], groups: [], filter: "all" };
    mockCategories = [];
    mockTunerGroups = null;
  });

  it("lists custom groups, then playlist groups, then categories after All", () => {
    mockPreferences = { favorites: [{ name: "KQED" }], groups: [{ id: "g1", name: "Mine", channels: [] }], filter: "all" };
    mockTunerGroups = [
      { name: "News", channelIds: ["a"] },
      { name: "Kids", channelIds: ["b"] },
    ];
    mockCategories = ["sports"];
    expect(render().map((choice) => choice.filter)).toEqual(["favorites", "all", "group:g1", "playlist:News", "playlist:Kids", "category:sports"]);
  });

  it("keeps a picked playlist group's slot only while the groups still load", () => {
    mockPreferences = { favorites: [], groups: [], filter: "playlist:News" };
    expect(render().map((choice) => choice.filter)).toEqual(["all", "playlist:News"]);
    // Loaded with the group: one entry, from the groups themselves.
    mockTunerGroups = [{ name: "News", channelIds: ["a"] }];
    expect(render().map((choice) => choice.filter)).toEqual(["all", "playlist:News"]);
    // Loaded without it: the dead pick is gone (usePlaylistChannelIds resets the filter).
    mockTunerGroups = [];
    expect(render().map((choice) => choice.filter)).toEqual(["all"]);
  });

  it("shows Favorites while it is picked even with no favorite left", () => {
    mockPreferences = { favorites: [], groups: [], filter: "favorites" };
    expect(render().map((choice) => choice.filter)).toEqual(["favorites", "all"]);
  });
});
