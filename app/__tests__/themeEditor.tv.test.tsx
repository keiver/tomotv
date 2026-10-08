/**
 * The theme editor on Apple TV is one card filling one screen: nothing scrolls, the preview on top, the
 * palette, and the sliders alone in the footer, where nothing sits beside them to take left or right.
 * Save sits above the card, asks for the name in the system prompt, and goes back to the list.
 */
import ThemeEditorScreen from "@/app/theme-editor";
import { SwatchGrid } from "@/components/theme/swatch-grid";
import { saveTheme } from "@/services/themeLibrary";
import React from "react";
import { Alert, type AlertButton, ScrollView, TextInput, TVFocusGuideView } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockBack = jest.fn();
jest.mock("react-native", () => {
  const reactNative = jest.requireActual("react-native");
  Object.defineProperty(reactNative.Platform, "isTV", { configurable: true, value: true });
  return reactNative;
});
jest.mock("expo-router", () => ({ Stack: { Screen: () => null }, useLocalSearchParams: () => ({}), useRouter: () => ({ back: mockBack, push: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/glass-button", () => ({ GlassButton: (props: object) => require("react").createElement("GlassButton", props) }));
jest.mock("@/components/theme/theme-preview", () => ({ ThemePreview: (props: object) => require("react").createElement("ThemePreview", props) }));
jest.mock("@/components/theme/hsb-slider", () => ({ HsbSlider: (props: object) => require("react").createElement("HsbSlider", props) }));
jest.mock("@/services/themeLibrary", () => ({ saveTheme: jest.fn(async () => "synced"), deleteTheme: jest.fn(async () => undefined) }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

describe("theme editor on TV", () => {
  it("is one card of preview, palette and sliders, with Save above it going back to the list, and no scrolling", () => {
    const prompt = jest.spyOn(Alert, "prompt").mockImplementation(() => {});
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<ThemeEditorScreen />);
    });
    expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
    expect(tree.root.findAllByType(TVFocusGuideView)).toHaveLength(0);
    // No text field on screen, so nothing wears UIKit's rounded focus platter: both ask in the system prompt.
    expect(tree.root.findAllByType(TextInput)).toHaveLength(0);

    // The card: the first ancestor of the band holding three sections.
    let card = tree.root.findByType("ThemePreview" as never).parent!;
    while (card.children.length !== 3) card = card.parent!;
    const [band, palette, footer] = card.children as TestRenderer.ReactTestInstance[];
    expect(band.findByType("ThemePreview" as never).props.cardHeight).toBeGreaterThan(0);
    expect(palette.findAllByType(SwatchGrid)).toHaveLength(1);
    expect(footer.findAllByType("HsbSlider" as never)).toHaveLength(3);
    expect(card.findAllByType("GlassButton" as never)).toHaveLength(0);

    // The hex tile asks for the digits, and a colour typed there becomes the draft.
    const press = (call: number, label: string, text: string) =>
      act(() => ((prompt.mock.calls[call][2] as AlertButton[]).find((button) => button.text === label)!.onPress as (value: string) => void)(text));
    const hexTile = palette.findAll((node) => node.props.accessibilityLabel === "Hex" && typeof node.props.onPress === "function")[0];
    act(() => hexTile.props.onPress());
    expect(prompt.mock.calls[0][0]).toBe("Hex");
    press(0, "OK", "123456");

    const save = tree.root.findByType("GlassButton" as never);
    act(() => save.props.onPress());
    press(1, "Save", "Sea");
    expect(saveTheme).toHaveBeenCalledWith(expect.objectContaining({ name: "Sea", accent: "#123456" }));
    expect(mockBack).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
    expect(saveTheme).toHaveBeenCalledTimes(1);
    prompt.mockRestore();
  });
});
