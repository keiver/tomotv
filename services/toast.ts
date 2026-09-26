/**
 * Transient notifications. Touch platforms float a pill (components/toast-host.tsx). tvOS never
 * floats a React Native view over focusables, so there the pill is the TVToast native module's
 * non-interactive window, which also draws above the presented player; a binary without the
 * module falls back to a VoiceOver announcement, plus a native alert for an error.
 */
import { AccessibilityInfo, Alert, NativeModules, Platform } from "react-native";

export type ToastKind = "info" | "error";
export interface Toast {
  message: string;
  kind: ToastKind;
}

const listeners = new Set<(toast: Toast) => void>();

export function subscribeToast(cb: (toast: Toast) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

const nativeToast: { show: (message: string, isError: boolean) => void } | undefined = NativeModules.TVToast;

export function showToast(message: string, kind: ToastKind = "info"): void {
  AccessibilityInfo.announceForAccessibility(message);
  if (Platform.isTV) {
    if (nativeToast?.show) nativeToast.show(message, kind === "error");
    else if (kind === "error") Alert.alert(message);
    return;
  }
  for (const listener of listeners) listener({ message, kind });
}
