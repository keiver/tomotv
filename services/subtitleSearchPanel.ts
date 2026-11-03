/**
 * The native subtitle panel (native/ios/SubtitleSearch), as JS drives it: present it with a state,
 * update that state, listen for the viewer's query, language, pick, timing and take-all presses,
 * and hear when it closed.
 */
import { NativeEventEmitter, NativeModules } from "react-native";
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
  /** The timing controls of the kept pick that is playing, under its row. */
  timing?: PanelTrack | null;
}

/** The timing controls of a kept pick, under its result row. */
export interface PanelTrack {
  /** The stream index the shift and sync events name. */
  id: number;
  offsetLabel: string;
  earlierLabel: string;
  laterLabel: string;
  /** The words on the step buttons themselves ("−0.5 s", "+0.5 s"); the labels above are what a screen reader says. */
  earlierTitle: string;
  laterTitle: string;
  resetLabel: string;
  syncLabel: string;
  /** A match can only run while the video plays; the sync button hides without it. */
  canSync: boolean;
  /** A match against the audio is running: the sync button spins and takes no press. */
  syncing: boolean;
  /** The line under the row: how the last match went, empty when none ran. */
  note: string;
}

/** One video's search: its own query, state and results. A lone job shows no heading. */
export interface PanelJob {
  /** The item id the query and pick events name. */
  id: string;
  /** The episode mark ("S04E06"), empty for a movie or a lone video. */
  label: string;
  /** The video's title, empty when the job is the whole search. */
  heading: string;
  query: string;
  stateLine: string;
  note: string;
  busy: boolean;
  results: PanelResult[];
}

export interface PanelState {
  title: string;
  /** The provider credit beside the title. */
  credit: string;
  /** The viewer's theme colour, "#RRGGBB". */
  accent: string;
  /** The alert a result press raises before it downloads: its title, the downloads left line (empty until known) and its buttons. */
  confirm: { title: string; remaining: string; download: string; cancel: string };
  /** Every language, the likely ones first; the panel shows the selected one on its pill and the rest in a menu. */
  languages: PanelLanguage[];
  selectedLanguage: string;
  /** Set while hash matches wait: the one button that takes them all. */
  takeAll: { label: string; busy: boolean } | null;
  /** "N files already have the language", or empty. */
  skippedLine: string;
  /** Shown when no job exists: every file subtitled, or nothing to search; empty otherwise. */
  emptyLine: string;
  queryPlaceholder: string;
  searchLabel: string;
  closeLabel: string;
  jobs: PanelJob[];
}

export interface PanelHandlers {
  onQueryChanged: (jobId: string, query: string) => void;
  onLanguageChanged: (code: string) => void;
  onPick: (jobId: string, id: string) => void;
  /** A timing press: the track's stream index and the step in milliseconds, or null for the reset. */
  onShift: (trackId: number, deltaMs: number | null) => void;
  /** The sync button: match that track to the audio. */
  onSync: (trackId: number) => void;
  /** The take-all button: every hash match and lone result at once. */
  onTakeAll: () => void;
  onDismissed: () => void;
}

interface NativePanel {
  present(state: PanelState): Promise<void>;
  update(state: PanelState): Promise<void>;
  dismiss(): Promise<void>;
}

const native = (NativeModules as { SubtitleSearch?: NativePanel }).SubtitleSearch;

export function subtitlePanelAvailable(): boolean {
  return !!native;
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
    emitter.addListener("onSubtitlePanelQueryChanged", (event: { jobId: string; query: string }) => handlers.onQueryChanged(event.jobId, event.query)),
    emitter.addListener("onSubtitlePanelLanguageChanged", (event: { code: string }) => handlers.onLanguageChanged(event.code)),
    emitter.addListener("onSubtitlePanelPick", (event: { jobId: string; id: string }) => handlers.onPick(event.jobId, event.id)),
    emitter.addListener("onSubtitlePanelShift", (event: { trackId: number; deltaMs: number | null }) => handlers.onShift(event.trackId, typeof event.deltaMs === "number" ? event.deltaMs : null)),
    emitter.addListener("onSubtitlePanelSync", (event: { trackId: number }) => handlers.onSync(event.trackId)),
    emitter.addListener("onSubtitlePanelTakeAll", () => handlers.onTakeAll()),
    emitter.addListener("onSubtitlePanelDismissed", () => handlers.onDismissed()),
  ];
  return () => subscriptions.forEach((subscription) => subscription.remove());
}
