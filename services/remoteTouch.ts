import { NativeEventEmitter, NativeModules, Platform } from "react-native";

const { RemoteTouch } = NativeModules;

const handlers = new Set<() => void>();
let subscription: { remove: () => void } | null = null;

/**
 * Two touches on the Apple TV remote's surface, with no click. The native recognizer is armed
 * with the first listener and removed with the last; off Apple TV this hands back a no-op.
 */
export function subscribeRemoteDoubleTouch(handler: () => void): () => void {
  if (!Platform.isTV || !RemoteTouch) return () => {};
  handlers.add(handler);
  if (!subscription) {
    subscription = new NativeEventEmitter(RemoteTouch).addListener("onRemoteDoubleTouch", () => {
      for (const listener of [...handlers]) listener();
    });
    RemoteTouch.setArmed(true);
  }
  return () => {
    if (!handlers.delete(handler) || handlers.size > 0) return;
    subscription?.remove();
    subscription = null;
    RemoteTouch.setArmed(false);
  };
}
