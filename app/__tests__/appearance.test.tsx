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
jest.mock("react-native-gesture-handler", () => ({ GestureHandlerRootView: ({ children }: { children: React.ReactNode }) => children }));
jest.mock("@/components/settings/SwipeToRemove", () => ({ SwipeToRemove: ({ children }: { children: React.ReactNode }) => children }));
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

const seaRow = (tree: TestRenderer.ReactTestRenderer) => tree.root.findAll((node) => node.props.title === "Sea" && typeof node.props.onLongPress === "function")[0];

describe("Appearance", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME });
  });

  it("lists the four built-in themes ahead of the saved ones, Gold chosen by default", () => {
    const tree = render();
    const titles = tree.root.findAll((node) => typeof node.props.title === "string" && typeof node.props.onPress === "function" && node.props.isLast === undefined).map((node) => node.props.title);
    expect([...new Set(titles)].slice(0, 5)).toEqual(["Gold", "Blue", "Green", "Purple", "Sea"]);
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
