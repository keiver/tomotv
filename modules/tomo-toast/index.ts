import type { EventSubscription } from "expo-modules-core";
import { AccessibilityInfo, Alert } from "react-native";
import { type NativePayload, type NativeToastModule, nativeToast as native, type ToastDismissReason, type ToastKind, type ToastTheme } from "./native";

export type { ToastDismissReason, ToastKind, ToastTheme };

export interface ToastOptions {
  title: string;
  message?: string;
  kind?: ToastKind;
  /** SF Symbol name; an unknown name falls back to the kind's symbol. */
  icon?: string;
  /** Reuse an id to update the card in place instead of queueing another. */
  id?: string;
  /** Fills the bar and holds until an update with progress false resolves it. */
  progress?: boolean;
  durationMs?: number;
}

/** Reading time: 3s plus 50ms a character, capped at 7s; errors stay 2s longer. */
export function toastDurationMs(title: string, message = "", kind: ToastKind = "info"): number {
  const base = Math.min(7000, Math.max(3000, 3000 + 50 * (title.length + message.length)));
  return kind === "error" ? base + 2000 : base;
}

// The last full options per live id, so update() can send a patch as a whole card.
const live = new Map<string, NativePayload>();
let seq = 0;
let listeningTo: NativeToastModule | null = null;

function trackDismissals(module: NativeToastModule): void {
  if (listeningTo === module) return;
  listeningTo = module;
  module.addListener("onDismiss", ({ id }) => {
    live.delete(id);
  });
}

function payload(options: ToastOptions, id: string): NativePayload {
  const kind = options.kind ?? "info";
  return { ...options, id, kind, durationMs: options.durationMs ?? toastDurationMs(options.title, options.message, kind) };
}

// A binary without the module still speaks the toast, and errors still reach the user.
function fallback(toast: NativePayload): void {
  AccessibilityInfo.announceForAccessibility(toast.message ? `${toast.title}. ${toast.message}` : toast.title);
  if (toast.kind === "error") Alert.alert(toast.title, toast.message);
}

export function isNativeToastAvailable(): boolean {
  return native !== null;
}

export function configureToast(theme: ToastTheme): void {
  void native?.configure(theme);
}

/** Shows a card, or updates the one already carrying `options.id`. Returns the id. */
export function showToast(options: ToastOptions): string {
  const id = options.id ?? `toast-${++seq}`;
  const toast = payload(options, id);
  if (!native) {
    fallback(toast);
    return id;
  }
  trackDismissals(native);
  live.set(id, toast);
  void native.show(toast);
  return id;
}

/** Merges into a live card; a patch for an id already gone shows a fresh card only if it has a title. */
export function updateToast(id: string, patch: Partial<ToastOptions>): void {
  const current = live.get(id);
  const merged = { ...current, ...patch, durationMs: patch.durationMs } as ToastOptions;
  if (!merged.title) return;
  showToast({ ...merged, id });
}

export function dismissToast(id: string): void {
  live.delete(id);
  void native?.dismiss(id);
}

export function dismissAllToasts(): void {
  live.clear();
  void native?.dismissAll();
}

export function addToastListener(event: "onShow", listener: (event: { id: string }) => void): EventSubscription | null;
export function addToastListener(event: "onDismiss", listener: (event: { id: string; reason: ToastDismissReason }) => void): EventSubscription | null;
export function addToastListener(event: "onShow" | "onDismiss", listener: (event: { id: string; reason: ToastDismissReason }) => void): EventSubscription | null {
  return native ? native.addListener(event as "onDismiss", listener) : null;
}
