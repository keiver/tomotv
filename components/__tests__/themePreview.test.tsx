/** The editor's preview is one card in the draft colour: landscape, focused, read only, the Tomo TV poster. */
import { ThemePreview } from "@/components/theme/theme-preview";
import { itemSlotShape } from "@/constants/app";
import { useCardPalette } from "@/hooks/useCardPalette";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

// The stand-in card reports the palette it would draw with.
jest.mock("@/components/video-grid-item", () => ({
  VideoGridItem: (props: object) => {
    const palette = (require("@/hooks/useCardPalette") as { useCardPalette: typeof useCardPalette }).useCardPalette();
    return require("react").createElement("VideoGridItem", { ...props, accent: palette.accent });
  },
}));

describe("ThemePreview", () => {
  it("draws one focused, inert card with the poster in its landscape shape, in the draft colour", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ThemePreview accent="#1DBFAE" cardHeight={300} />);
    });
    const cards = tree.root.findAllByType("VideoGridItem" as never);
    expect(cards).toHaveLength(1);
    const [card] = cards;
    expect(card.props).toMatchObject({ accent: "#1DBFAE", cardHeight: 300, fitArtwork: true, highlighted: true, inert: true, poster: require("@/assets/images/theme-default-poster.png") });
    expect(itemSlotShape(card.props.video.PrimaryImageAspectRatio)).toBe("landscape");
    act(() => tree.update(<ThemePreview accent="#FF6676" cardHeight={300} />));
    expect(tree.root.findByType("VideoGridItem" as never).props.accent).toBe("#FF6676");
    act(() => tree.unmount());
  });
});
