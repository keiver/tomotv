/** Group rows: a press toggles membership in place, a change elsewhere redraws, the rolling row names a new group. */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";
import { ChannelGroupSection } from "@/components/live-tv/channel-group-section";
import { createGroup, getLiveTvPreferences, isChannelInGroup, toggleChannelInGroup, updateLiveTvPreferences } from "@/services/liveTvPreferences";

jest.mock("@/utils/logger", () => ({ logger: { error: jest.fn(), info: jest.fn(), debug: jest.fn(), warn: jest.fn() } }));
jest.mock("@/components/settings/ListRow", () => ({
  TRAILING_SIZE: 20,
  ListRow: ({ title, onPress, trailingIcon }: { title: string; onPress: () => void; trailingIcon?: unknown }) => {
    const { Text } = require("react-native");
    return <Text testID={`row:${title}`} accessibilityState={{ checked: !!trailingIcon }} onPress={onPress} />;
  },
}));
jest.mock("@/components/settings/RollingFieldRow", () => ({
  RollingFieldRow: (props: { value: string; onChangeText: (v: string) => void; onSave: () => void }) => {
    const { TextInput } = require("react-native");
    return <TextInput testID="group-name" value={props.value} onChangeText={props.onChangeText} onBlur={props.onSave} />;
  },
}));

const channel = { Id: "c1", Name: "One", ChannelNumber: "7" };
const row = (tree: TestRenderer.ReactTestRenderer, title: string) => tree.root.findByProps({ testID: `row:${title}` });
const checked = (tree: TestRenderer.ReactTestRenderer, title: string) => row(tree, title).props.accessibilityState.checked;

function mount() {
  let tree: TestRenderer.ReactTestRenderer | undefined;
  act(() => {
    tree = TestRenderer.create(<ChannelGroupSection channel={channel} />);
  });
  return tree!;
}

describe("ChannelGroupSection", () => {
  beforeEach(() => {
    act(() => updateLiveTvPreferences({ groups: [] }));
  });

  it("toggles the channel in and out of a group without leaving", () => {
    act(() => {
      createGroup("Sports");
    });
    const tree = mount();
    expect(checked(tree, "Sports")).toBe(false);
    act(() => row(tree, "Sports").props.onPress());
    expect(checked(tree, "Sports")).toBe(true);
    expect(isChannelInGroup(getLiveTvPreferences().groups[0], channel)).toBe(true);
    act(() => row(tree, "Sports").props.onPress());
    expect(checked(tree, "Sports")).toBe(false);
  });

  it("redraws when membership changes elsewhere", () => {
    let id = "";
    act(() => {
      id = createGroup("News").id;
    });
    const tree = mount();
    act(() => toggleChannelInGroup(id, channel));
    expect(checked(tree, "News")).toBe(true);
  });

  it("names a new group and lands the channel in it, then clears the field", () => {
    const tree = mount();
    act(() => tree.root.findByProps({ testID: "group-name" }).props.onChangeText("  Kids  "));
    act(() => tree.root.findByProps({ testID: "group-name" }).props.onBlur());
    const [group] = getLiveTvPreferences().groups;
    expect(group.name).toBe("Kids");
    expect(isChannelInGroup(group, channel)).toBe(true);
    expect(checked(tree, "Kids")).toBe(true);
    expect(tree.root.findByProps({ testID: "group-name" }).props.value).toBe("");
  });

  it("creates nothing when the name is left empty", () => {
    const tree = mount();
    act(() => tree.root.findByProps({ testID: "group-name" }).props.onBlur());
    expect(getLiveTvPreferences().groups).toHaveLength(0);
  });
});
