import { NativeEventEmitter, NativeModules, Platform } from "react-native";

/** The LocalRemuxer bridge, read at call time so a module installed after import is seen. */
export function engineModule() {
  return NativeModules.LocalRemuxer;
}

/** The LiveSources bridge: XMLTV guides and M3U playlists. */
export function liveSourcesModule() {
  return NativeModules.LiveSources;
}

export function isLocalRemuxAvailable(): boolean {
  return Platform.OS === "ios" && !!engineModule()?.startRemux;
}

/** Whether the running binary declares an event. A Metro reload can carry JS that knows one the
 *  installed native build does not, and subscribing to it there breaks the module outright. */
export function nativeEmits(event: string): boolean {
  const events = (engineModule() as { events?: unknown } | undefined)?.events;
  return Array.isArray(events) && events.includes(event);
}

export function engineEmitter(): NativeEventEmitter {
  return new NativeEventEmitter(engineModule());
}
