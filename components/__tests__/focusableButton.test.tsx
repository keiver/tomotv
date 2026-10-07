/** A caller can mark a button disabled for assistive tech while it stays focusable, as the spent stop circle does. */
import { FocusableButton } from "@/components/FocusableButton";
import { cardPalette, DEFAULT_CARD_THEME } from "@/services/cardTheme";
import { updateUiPreferences } from "@/services/uiPreferences";
import { withAlpha } from "@/utils/color";
import React from "react";
import { StyleSheet, Text, type TextStyle, type ViewStyle } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

type PressableProps = { accessibilityState?: { disabled?: boolean; selected?: boolean }; isTVSelectable?: boolean; disabled?: boolean };

async function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  // The first node carrying the button's own props, before any host view flattens them.
  return renderer.root.findAll((node) => node.props.accessibilityRole === "button" && "isTVSelectable" in node.props)[0].props as PressableProps;
}

describe("FocusableButton accessibility state", () => {
  it("reports a caller's disabled while the button stays selectable", async () => {
    const props = await render(<FocusableButton title="Stop" accessibilityState={{ disabled: true }} onPress={() => {}} />);
    expect(props.accessibilityState?.disabled).toBe(true);
    expect(props.isTVSelectable).toBe(true);
  });

  it("keeps a caller's selected and reports its own disabled", async () => {
    const props = await render(<FocusableButton title="Heart" accessibilityState={{ selected: true }} disabled onPress={() => {}} />);
    expect(props.accessibilityState).toMatchObject({ selected: true, disabled: true });
  });

  it("reads enabled when nothing disables it", async () => {
    const props = await render(<FocusableButton title="Play" onPress={() => {}} />);
    expect(props.accessibilityState?.disabled).toBe(false);
  });
});

describe("FocusableButton theme", () => {
  afterEach(() => act(() => updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME })));

  async function styles(element: React.ReactElement) {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(element);
    });
    const pressable = renderer.root.findAll((node) => node.props.accessibilityRole === "button" && typeof node.props.style === "function")[0];
    const style = (focused: boolean) => StyleSheet.flatten(pressable.props.style({ pressed: false, focused })) as ViewStyle;
    const text = StyleSheet.flatten(renderer.root.findByType(Text).props.style) as TextStyle;
    return { style, text };
  }

  it("fills the primary with the chosen accent and its ink, and focuses it in the lighter tone", async () => {
    act(() => updateUiPreferences({ cardTheme: { id: "blue", name: "", accent: "#3D8EFF" } }));
    const palette = cardPalette("#3D8EFF");
    const { style, text } = await styles(<FocusableButton title="Play" onPress={() => {}} />);
    expect(style(false).backgroundColor).toBe(palette.accent);
    expect(style(true).backgroundColor).toBe(palette.accentFocused);
    expect(text.color).toBe(palette.onAccent);
  });

  it("outlines the secondary in the accent and washes it at 15% on focus", async () => {
    act(() => updateUiPreferences({ cardTheme: { id: "green", name: "", accent: "#0ABF37" } }));
    const { style, text } = await styles(<FocusableButton title="Switch" variant="secondary" onPress={() => {}} />);
    expect(style(false).borderColor).toBe("#0ABF37");
    expect(style(true).backgroundColor).toBe(withAlpha("#0ABF37", 0.15));
    expect(text.color).toBe("#0ABF37");
  });
});
