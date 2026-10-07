/**
 * The theme editor keeps a colour only through Save: the navigation bar's Save asks for a name in the
 * system prompt, saves once and leaves. Without a name, or without Save, nothing is kept. The hex box
 * at the grid's start takes a colour the palette has not got.
 */
import ThemeEditorScreen from "@/app/theme-editor";
import { getUiPreferences, updateUiPreferences } from "@/services/uiPreferences";
import { DEFAULT_CARD_THEME } from "@/services/cardTheme";
import { saveTheme } from "@/services/themeLibrary";
import React from "react";
import { Alert, type AlertButton, StyleSheet, Text, TextInput } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

let mockParams: Record<string, string> = {};
const mockBack = jest.fn();
let mockOptions: { unstable_headerRightItems?: () => { label: string; onPress: () => void }[] } = {};
jest.mock("expo-router", () => ({
  Stack: {
    Screen: ({ options }: { options: typeof mockOptions }) => {
      mockOptions = options;
      return null;
    },
  },
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/theme/theme-preview", () => ({ ThemePreview: () => null }));
jest.mock("@/components/theme/hsb-slider", () => ({ HsbSlider: () => null }));
jest.mock("@/services/themeLibrary", () => ({ saveTheme: jest.fn(async () => "synced") }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const mockSave = saveTheme as jest.Mock;
const mockPrompt = jest.spyOn(Alert, "prompt").mockImplementation(() => {});

function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<ThemeEditorScreen />);
  });
  return tree;
}

/** The prompt's buttons as the screen handed them to Alert.prompt. */
const promptButton = (match: (button: AlertButton) => boolean) => (mockPrompt.mock.calls[0][2] as AlertButton[]).find(match)!;
// A plain-text prompt hands its button the typed string.
const promptSave = (text: string) => (promptButton((button) => button.text === "Save").onPress as (value: string) => void)(text);
const openSave = () => act(() => mockOptions.unstable_headerRightItems?.()[0].onPress());

const tile = (tree: TestRenderer.ReactTestRenderer, name: string) => tree.root.findAll((node) => typeof node.props.onPress === "function" && node.props.accessibilityLabel === name)[0];
const input = (tree: TestRenderer.ReactTestRenderer, label: string) => tree.root.findAll((node) => node.type === TextInput && node.props.accessibilityLabel === label)[0];

describe("theme editor", () => {
  beforeEach(() => {
    mockParams = {};
    mockOptions = {};
    jest.clearAllMocks();
    updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME });
  });

  it("drops a changed colour that was never saved", () => {
    const tree = render();
    act(() => tile(tree, "Teal").props.onPress());
    act(() => tree.unmount());
    expect(mockSave).not.toHaveBeenCalled();
    expect(getUiPreferences().cardTheme).toEqual(DEFAULT_CARD_THEME);
  });

  it("asks for the name in the system prompt from the navigation bar's Save, saves once, chooses it and leaves", () => {
    const tree = render();
    act(() => tile(tree, "Teal").props.onPress());
    const [save] = mockOptions.unstable_headerRightItems?.() ?? [];
    expect(save.label).toBe("Save");
    act(() => save.onPress());
    const [title, , , type, defaultValue] = mockPrompt.mock.calls[0];
    expect([title, type, defaultValue]).toEqual(["Save Theme", "plain-text", ""]);
    act(() => promptSave("Sea"));
    expect(mockBack).toHaveBeenCalledTimes(1);
    act(() => tree.unmount());
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toMatchObject({ name: "Sea", accent: "#09BA9D" });
    expect(getUiPreferences().cardTheme).toEqual(mockSave.mock.calls[0][0]);
  });

  it("saves nothing and stays when the name is left empty", () => {
    const tree = render();
    openSave();
    act(() => promptSave("  "));
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it("saves nothing when the prompt is cancelled", () => {
    const tree = render();
    openSave();
    expect(promptButton((button) => button.style === "cancel").onPress).toBeUndefined();
    act(() => tree.unmount());
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("renames a saved theme under its own id, the prompt opening on its name", () => {
    mockParams = { id: "t1", name: "Sea", accent: "#12CBC4" };
    const tree = render();
    openSave();
    expect(mockPrompt.mock.calls[0][4]).toBe("Sea");
    act(() => promptSave("Ocean"));
    act(() => tree.unmount());
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][0]).toEqual({ id: "t1", name: "Ocean", accent: "#12CBC4" });
  });

  it("takes a colour off the palette from the hex box, and names a bad one in a slot that never changes size", () => {
    const tree = render();
    const hex = () => input(tree, "Hex");
    const note = () => tree.root.findAll((node) => node.type === Text && node.props.testID === "theme-note")[0];
    const slot = StyleSheet.flatten(note().props.style);
    expect(note().props.children).toBe("");
    act(() => hex().props.onFocus());
    act(() => hex().props.onChangeText("zz"));
    act(() => hex().props.onEndEditing());
    expect(note().props.children).toBe("Enter six hex digits, like FFC312");
    expect(StyleSheet.flatten(note().props.style).height).toBe(slot.height);
    act(() => hex().props.onFocus());
    act(() => hex().props.onChangeText("222222"));
    act(() => hex().props.onEndEditing());
    expect(note().props.children).toBe("This color is hard to see on the dark background.");
    expect(StyleSheet.flatten(note().props.style).height).toBe(slot.height);
    act(() => hex().props.onFocus());
    act(() => hex().props.onChangeText("123456"));
    act(() => hex().props.onEndEditing());
    expect(hex().props.value).toBe("#123456");
    openSave();
    act(() => promptSave("Mine"));
    act(() => tree.unmount());
    expect(mockSave.mock.calls[0][0]).toMatchObject({ name: "Mine", accent: "#123456" });
  });
});
