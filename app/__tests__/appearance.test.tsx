/**
 * Saved themes on the Appearance list: a press chooses, the chosen one pressed again opens the editor,
 * a long press asks before removing it, and removing the chosen one returns the cards to gold.
 */
import AppearanceScreen from "@/app/appearance";
import { DEFAULT_CARD_THEME } from "@/services/cardTheme";
import { deleteTheme } from "@/services/themeLibrary";
import { getUiPreferences, updateUiPreferences } from "@/services/uiPreferences";
import React from "react";
import { Alert, type AlertButton } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const sea = { id: "t1", name: "Sea", accent: "#12CBC4" };
const mockPush = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ push: mockPush, back: jest.fn() }) }));
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock("@/components/ambient-background", () => ({ AmbientBackground: () => null }));
jest.mock("@/components/settings/SectionFooter", () => ({ SectionFooter: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/hooks/useSavedThemes", () => ({ useSavedThemes: () => ({ themes: [{ id: "t1", name: "Sea", accent: "#12CBC4" }], pending: [], status: "ready" }) }));
jest.mock("@/services/themeLibrary", () => ({ deleteTheme: jest.fn(async () => undefined), themeSaveInFlight: () => false }));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

function render() {
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<AppearanceScreen />);
  });
  return tree;
}

/** The strip's cells, by their theme-cell test ids; only the Pressable element itself carries the handlers. */
const cells = (tree: TestRenderer.ReactTestRenderer) =>
  tree.root.findAll((node) => typeof node.props.testID === "string" && node.props.testID.startsWith("theme-cell-") && typeof node.props.onPress === "function");
const seaRow = (tree: TestRenderer.ReactTestRenderer) => cells(tree).filter((node) => node.props.accessibilityLabel === "Sea")[0];

describe("Appearance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME, background: "artwork" });
  });

  it("strips the four built-in themes ahead of the saved ones, Tomo chosen by default", () => {
    const tree = render();
    const labels = cells(tree).map((node) => node.props.accessibilityLabel);
    expect(labels).toEqual(["Tomo", "Blue", "Green", "Purple", "Sea"]);
    expect(cells(tree)[0].props.accessibilityState).toEqual({ selected: true });
    act(() => tree.unmount());
  });

  it("opens the editor on the chosen built-in's colour alone, so a save mints a new theme", () => {
    const tree = render();
    act(() => cells(tree)[0].props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/theme-editor", params: { accent: DEFAULT_CARD_THEME.accent } });
    act(() => tree.unmount());
  });

  it("picks exactly one canvas: the Tomo light, the theme's colour, or folder artwork", () => {
    const tree = render();
    const row = (title: string) => tree.root.findAll((node) => node.props.title === title && typeof node.props.onPress === "function" && node.props.subtitle !== undefined)[0];
    act(() => row("Tomo").props.onPress());
    expect(getUiPreferences().background).toBe("tomo");
    act(() => row("Theme color").props.onPress());
    expect(getUiPreferences().background).toBe("accent");
    act(() => row("Folder artwork").props.onPress());
    expect(getUiPreferences().background).toBe("artwork");
    act(() => tree.unmount());
  });

  it("leaves New theme square-cornered while the footer closes the card under it", () => {
    const tree = render();
    const newTheme = tree.root.findAll((node) => node.props.title === "New theme" && typeof node.props.onPress === "function")[0];
    expect(newTheme.props.isLast).toBe(false);
    act(() => tree.unmount());
  });

  it("chooses a saved theme on the first press and opens it in the editor on the next", () => {
    const tree = render();
    act(() => seaRow(tree).props.onPress());
    expect(getUiPreferences().cardTheme).toEqual(sea);
    expect(mockPush).not.toHaveBeenCalled();
    act(() => seaRow(tree).props.onPress());
    expect(mockPush).toHaveBeenCalledWith({ pathname: "/theme-editor", params: { id: "t1", name: "Sea", accent: "#12CBC4" } });
    act(() => tree.unmount());
  });

  it("asks before removing on a long press, and a removed chosen theme returns the cards to gold", () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    updateUiPreferences({ cardTheme: sea });
    const tree = render();
    act(() => seaRow(tree).props.onLongPress());
    expect(deleteTheme).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as AlertButton[];
    act(() => buttons.find((button) => button.style === "destructive")?.onPress?.());
    expect(deleteTheme).toHaveBeenCalledWith("t1");
    expect(getUiPreferences().cardTheme).toEqual(DEFAULT_CARD_THEME);
    alert.mockRestore();
    act(() => tree.unmount());
  });
});
