/** The picked group keeps its green wash under focus: the gold ring marks focus, never a white fill. */
import { GuideGroupCell } from "@/components/live-tv/guide-group-cell";
import { COLORS } from "@/constants/colors";
import { currentPalette } from "@/hooks/useCardPalette";
import React from "react";
import { StyleSheet, Text, View } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@expo/vector-icons", () => ({ Ionicons: (props: object) => require("react").createElement("Ionicons", props) }));

function render(selected: boolean) {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<GuideGroupCell label="News" selected={selected} onPress={() => {}} />);
  });
  const focusable = tree.root.find((node) => node.props.isTVSelectable === true && typeof node.type !== "string");
  act(() => focusable.props.onFocus());
  const tile = tree.root.findAllByType(View)[0];
  return { tree, tile };
}

describe("GuideGroupCell", () => {
  it("keeps the pick's wash, label and checkmark under focus", () => {
    const { tree, tile } = render(true);
    expect(StyleSheet.flatten(tile.props.style).backgroundColor).toBe("rgba(52, 199, 89, 0.2)");
    expect(StyleSheet.flatten(tree.root.findByType(Text).props.style).color).toBe(COLORS.TEXT_PRIMARY);
    expect(tree.root.find((node) => node.props.name === "checkmark").props.color).toBe(COLORS.TEXT_PRIMARY);
  });

  it("draws the accent heart before the label only on the favorites cell", () => {
    const hearts = (favorite: boolean) => {
      let tree!: TestRenderer.ReactTestRenderer;
      act(() => {
        tree = TestRenderer.create(<GuideGroupCell label="Favorites" selected={false} favorite={favorite} onPress={() => {}} />);
      });
      return tree.root.findAll((node) => node.props.testID === "guide-group-favorite" && node.props.name === "heart" && typeof node.type === "string");
    };
    expect(hearts(true)).toHaveLength(1);
    expect(hearts(true)[0].props.color).toBe(currentPalette().accent);
    expect(hearts(false)).toHaveLength(0);
  });

  it("rests an unpicked group on the black floor under focus", () => {
    const { tile } = render(false);
    expect(StyleSheet.flatten(tile.props.style).backgroundColor).toBe("rgba(0, 0, 0, 0.4)");
  });
});
