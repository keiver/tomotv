/** The app adapter: string and options forms, and the app's theme sent once per language. */
import { configureToast, showToast as show } from "@/modules/tomo-toast";
import { t } from "@/services/i18n";

jest.mock("@/modules/tomo-toast", () => ({
  configureToast: jest.fn(),
  showToast: jest.fn(() => "toast-1"),
  updateToast: jest.fn(),
  dismissToast: jest.fn(),
}));
jest.mock("@/services/i18n", () => ({ t: jest.fn(() => "Close") }));

import { cardPalette, DEFAULT_CARD_THEME } from "@/services/cardTheme";
import { setToastPlayerOnScreen, showToast } from "@/services/toast";
import { updateUiPreferences } from "@/services/uiPreferences";
import { Platform } from "react-native";

describe("toast", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends the app theme before the first toast, and only once per language", () => {
    showToast("a");
    showToast("b");
    expect(configureToast).toHaveBeenCalledTimes(1);
    expect(configureToast).toHaveBeenCalledWith({
      tint: "#FFC312",
      text: "#2B1F05",
      danger: "#D70015",
      closeLabel: "Close",
    });
    (t as jest.Mock).mockReturnValue("Cerrar");
    showToast("c");
    expect(configureToast).toHaveBeenCalledTimes(2);
    expect(configureToast).toHaveBeenLastCalledWith(expect.objectContaining({ closeLabel: "Cerrar" }));
  });

  it("sends the theme again when the accent changes, with that fill's ink", () => {
    updateUiPreferences({ cardTheme: { id: "blue", name: "", accent: "#3D8EFF" } });
    showToast("d");
    expect(configureToast).toHaveBeenCalledTimes(1);
    expect(configureToast).toHaveBeenLastCalledWith(expect.objectContaining({ tint: "#3D8EFF", text: cardPalette("#3D8EFF").ink }));
    showToast("e");
    expect(configureToast).toHaveBeenCalledTimes(1);
    updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME });
  });

  it("maps the string form to a title and kind", () => {
    expect(showToast("Recording scheduled", "success")).toBe("toast-1");
    expect(show).toHaveBeenCalledWith({ title: "Recording scheduled", kind: "success" });
    showToast("Guide updated");
    expect(show).toHaveBeenLastCalledWith({ title: "Guide updated", kind: "info" });
  });

  it("passes the options form through untouched", () => {
    const options = { id: "guide-refresh", title: "Downloading guide", progress: true };
    showToast(options);
    expect(show).toHaveBeenCalledWith(options);
  });

  it("moves TV toasts to the top while the player is on screen, never on iOS", () => {
    setToastPlayerOnScreen(true);
    showToast("Recording started", "success");
    expect(show).toHaveBeenLastCalledWith({ title: "Recording started", kind: "success" });
    const isTV = jest.spyOn(Platform, "isTV", "get").mockReturnValue(true);
    showToast("Recording started", "success");
    expect(show).toHaveBeenLastCalledWith({ title: "Recording started", kind: "success", edge: "top" });
    showToast({ title: "Pinned", edge: "bottom" });
    expect(show).toHaveBeenLastCalledWith({ title: "Pinned", edge: "bottom" });
    setToastPlayerOnScreen(false);
    showToast("Guide updated");
    expect(show).toHaveBeenLastCalledWith({ title: "Guide updated", kind: "info" });
    isTV.mockRestore();
  });
});
