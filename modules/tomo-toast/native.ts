import { type EventSubscription, requireOptionalNativeModule } from "expo-modules-core";

export type ToastKind = "info" | "success" | "error";
export type ToastDismissReason = "timeout" | "swipe" | "close" | "replaced" | "api";

export interface ToastTheme {
  /** Card color; any React Native color string. */
  tint?: string;
  text?: string;
  /** Error icon and lifetime bar. */
  danger?: string;
  /** Card height as a fraction of the window height. */
  heightRatio?: number;
  /** VoiceOver name of the close button and action (iOS). */
  closeLabel?: string;
}

export interface NativePayload {
  id: string;
  title: string;
  message?: string;
  kind: ToastKind;
  icon?: string;
  progress?: boolean;
  durationMs: number;
}

export interface NativeToastModule {
  configure(theme: ToastTheme): Promise<void>;
  show(toast: NativePayload): Promise<void>;
  dismiss(id: string): Promise<void>;
  dismissAll(): Promise<void>;
  addListener(event: "onShow", listener: (event: { id: string }) => void): EventSubscription;
  addListener(event: "onDismiss", listener: (event: { id: string; reason: ToastDismissReason }) => void): EventSubscription;
}

/** Null in a binary built before the module existed. */
export const nativeToast = requireOptionalNativeModule<NativeToastModule>("TomoToast");
