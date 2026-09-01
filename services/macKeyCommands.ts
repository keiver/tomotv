import { IS_MAC } from "@/utils/hostEnvironment";
import { NativeEventEmitter, NativeModules } from "react-native";

/**
 * Hardware keys from the Mac build, delivered by
 * native/ios/MultiAudioResourceLoader/MacKeyCommands.swift.
 *
 * Off a Mac this whole module is inert: IS_MAC is false, no emitter is created
 * and subscribing hands back a no-op, so callers need no platform branches.
 */

/** Keys the native side registers, matching `extraCommands` in MacKeyCommands.swift. */
export const MAC_KEYS = ["escape", "playPause", "previousTrack", "nextTrack", "search", "settings", "previousPhoto", "nextPhoto", "seekBackward", "seekForward", "toggleVideoFill"] as const;

/** Which screen owns the contextual keys (bare arrows, Return). Nobody, by default. */
export type MacKeyContext = "" | "photo" | "seek";

/** Seconds one arrow press moves playback, matching the player's own skip buttons. */
export const MAC_SEEK_SECONDS = 15;

export type MacKey = (typeof MAC_KEYS)[number];

const { MacKeyCommands } = NativeModules;

function isMacKey(key: string | undefined): key is MacKey {
  return !!key && (MAC_KEYS as readonly string[]).includes(key);
}

export function isMacKeyCommandsAvailable(): boolean {
  return IS_MAC && !!MacKeyCommands;
}

/**
 * Claim the contextual keys, and hand them back on release.
 *
 * A stack, not a setter: audio can be playing while the photo viewer is open, so two owners
 * can hold a claim at once. The newest wins, and releasing it restores the one underneath
 * rather than disarming the keys entirely.
 */
const keyClaims: { owner: string; context: MacKeyContext }[] = [];

function applyKeyContext(): void {
  if (!isMacKeyCommandsAvailable()) return;
  MacKeyCommands.setKeyContext(keyClaims[keyClaims.length - 1]?.context ?? "");
}

export function claimMacContextKeys(owner: string, context: MacKeyContext): () => void {
  const claim = { owner, context };
  keyClaims.push(claim);
  applyKeyContext();
  return () => {
    const index = keyClaims.indexOf(claim);
    if (index === -1) return;
    keyClaims.splice(index, 1);
    applyKeyContext();
  };
}

/**
 * Listen for a key press. Returns the unsubscribe, always safe to call.
 */
export function subscribeMacKeyCommand(handler: (key: MacKey) => void): () => void {
  if (!isMacKeyCommandsAvailable()) return () => {};
  const emitter = new NativeEventEmitter(MacKeyCommands);
  const subscription = emitter.addListener("onMacKeyCommand", (event: { key?: string }) => {
    if (isMacKey(event?.key)) handler(event.key);
  });
  return () => subscription.remove();
}
