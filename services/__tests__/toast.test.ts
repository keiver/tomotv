/** The toast service: pill emission on touch platforms, native window routing on TV. */
import { AccessibilityInfo, Alert, NativeModules, Platform } from "react-native";

jest.mock("react-native", () => ({
  Platform: { isTV: false },
  Alert: { alert: jest.fn() },
  AccessibilityInfo: { announceForAccessibility: jest.fn() },
  NativeModules: { TVToast: { show: jest.fn() } },
}));

import { showToast, subscribeToast } from "@/services/toast";

describe("toast", () => {
  beforeEach(() => jest.clearAllMocks());

  it("emits to subscribers off TV and announces every message", () => {
    const listener = jest.fn();
    const unsubscribe = subscribeToast(listener);
    showToast("Recording scheduled");
    expect(listener).toHaveBeenCalledWith({ message: "Recording scheduled", kind: "info" });
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith("Recording scheduled");
    expect(Alert.alert).not.toHaveBeenCalled();
    unsubscribe();
    showToast("gone");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("routes TV to the native window, never the RN listeners", () => {
    (Platform as { isTV: boolean }).isTV = true;
    const listener = jest.fn();
    const unsubscribe = subscribeToast(listener);
    showToast("Recording failed", "error");
    showToast("Recording started");
    expect(listener).not.toHaveBeenCalled();
    expect(NativeModules.TVToast.show).toHaveBeenCalledWith("Recording failed", true);
    expect(NativeModules.TVToast.show).toHaveBeenCalledWith("Recording started", false);
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledTimes(2);
    unsubscribe();
    (Platform as { isTV: boolean }).isTV = false;
  });
});
