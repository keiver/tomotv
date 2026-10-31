/**
 * The tvOS subtitle panel (native/ios/SubtitleSearch), as JS drives it: present it with a state,
 * update that state, listen for the viewer's query, language and pick, and hear when it closed.
 */
import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { logger } from "@/utils/logger";

export interface PanelLanguage {
  code: string;
  name: string;
}

export interface PanelResult {
  id: string;
  name: string;
  meta: string;
  badges: string[];
  monogram: string;
  hashMatch: boolean;
  applying: boolean;
  applied: boolean;
}

export interface PanelState {
  title: string;
  query: string;
  queryPlaceholder: string;
  languages: PanelLanguage[];
  selectedLanguage: string;
  stateLine: string;
  note: string;
  busy: boolean;
  results: PanelResult[];
}

export interface PanelHandlers {
  onQueryChanged: (query: string) => void;
  onLanguageChanged: (code: string) => void;
  onPick: (id: string) => void;
  onDismissed: () => void;
}

interface NativePanel {
  present(state: PanelState): Promise<void>;
  update(state: PanelState): Promise<void>;
  dismiss(): Promise<void>;
}

const native = (NativeModules as { SubtitleSearch?: NativePanel }).SubtitleSearch;

export function subtitlePanelAvailable(): boolean {
  return Platform.isTV && !!native;
}

export async function presentSubtitlePanel(state: PanelState): Promise<boolean> {
  if (!native) return false;
  try {
    await native.present(state);
    return true;
  } catch (error) {
    logger.warn("Subtitle panel could not be presented", error, { service: "Subtitles" });
    return false;
  }
}

export async function updateSubtitlePanel(state: PanelState): Promise<void> {
  if (!native) return;
  try {
    await native.update(state);
  } catch (error) {
    logger.warn("Subtitle panel update failed", error, { service: "Subtitles" });
  }
}

export async function dismissSubtitlePanel(): Promise<void> {
  if (!native) return;
  try {
    await native.dismiss();
  } catch (error) {
    logger.warn("Subtitle panel dismiss failed", error, { service: "Subtitles" });
  }
}

/** Listens to the panel's events until the returned function is called. */
export function listenToSubtitlePanel(handlers: PanelHandlers): () => void {
  if (!native) return () => undefined;
  const emitter = new NativeEventEmitter(native as unknown as ConstructorParameters<typeof NativeEventEmitter>[0]);
  const subscriptions = [
    emitter.addListener("onSubtitlePanelQueryChanged", (event: { query: string }) => handlers.onQueryChanged(event.query)),
    emitter.addListener("onSubtitlePanelLanguageChanged", (event: { code: string }) => handlers.onLanguageChanged(event.code)),
    emitter.addListener("onSubtitlePanelPick", (event: { id: string }) => handlers.onPick(event.id)),
    emitter.addListener("onSubtitlePanelDismissed", () => handlers.onDismissed()),
  ];
  return () => subscriptions.forEach((subscription) => subscription.remove());
}
