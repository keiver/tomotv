import { IS_MAC } from "@/utils/hostEnvironment";
import { NativeEventEmitter, NativeModules } from "react-native";

/**
 * Hardware keys from the Mac build, delivered by
 * native/ios/MultiAudioResourceLoader/MacKeyCommands.swift.
 *
 * Off a Mac this whole module is inert: IS_MAC is false, no emitter is created
 * and subscribing hands back a no-op, so callers need no platform branches.
 */

/** Keys the native side registers. One today; the event carries the name so more cost no native change. */
export type MacKey = "escape";

const { MacKeyCommands } = NativeModules;

export function isMacKeyCommandsAvailable(): boolean {
  return IS_MAC && !!MacKeyCommands;
}

/**
 * Listen for a key press. Returns the unsubscribe, always safe to call.
 */
export function subscribeMacKeyCommand(handler: (key: MacKey) => void): () => void {
  if (!isMacKeyCommandsAvailable()) return () => {};
  const emitter = new NativeEventEmitter(MacKeyCommands);
  const subscription = emitter.addListener("onMacKeyCommand", (event: { key?: string }) => {
    if (event?.key === "escape") handler("escape");
  });
  return () => subscription.remove();
}
