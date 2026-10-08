/**
 * What the engine measured about a file on this device. A session that ran below realtime is
 * remembered, and once two of them agree the app can route the next play off the engine from the
 * first request. Two, because a segment's time includes reading the source, so one slow
 * measurement can be the link rather than the device. A verdict expires (VERDICT_TTL_MS) so a
 * pre-flight probe measures again: a device's decode speed is stable but a link is not. A verdict
 * from another app build does not count. Keys and the build label are the app's.
 */
import { File, Paths } from "expo-file-system";
import { Platform } from "react-native";
import { engineLog } from "./config";

/** The regression driver clears it before every item: the simulator run deletes it, a probe URL arming clears it. */
export const VERDICTS_FILENAME = "engine-verdicts.json";

/** Measurements that agreed before a file is held off the engine. */
export const VERDICT_STRIKES = 2;

/** A verdict older than this stops counting; the next play re-probes the link live. */
export const VERDICT_TTL_MS = 30 * 60 * 1000;

export type EngineVerdict = { app: string; at: number; reason: string; produceSeconds: number; segmentSeconds: number; thermal: string; strikes: number };

export type VerdictSample = { produceSeconds?: number; segmentSeconds: number; thermal: string };

let verdicts: Record<string, EngineVerdict> | null = null;

function verdictsFile(): File {
  // tvOS grants an app no writable Documents; its caches are the persistent store it has.
  return new File(Platform.isTV ? Paths.cache : Paths.document, VERDICTS_FILENAME);
}

function load(): Record<string, EngineVerdict> {
  if (verdicts) return verdicts;
  try {
    const file = verdictsFile();
    verdicts = file.exists ? (JSON.parse(file.textSync()) as Record<string, EngineVerdict>) : {};
  } catch (error) {
    engineLog().warn("Engine verdicts read failed", error, { service: "EngineVerdicts" });
    verdicts = {};
  }
  return verdicts;
}

function save(): void {
  try {
    const file = verdictsFile();
    if (file.exists) file.delete();
    file.create();
    file.write(JSON.stringify(verdicts ?? {}));
  } catch (error) {
    engineLog().warn("Engine verdicts write failed", error, { service: "EngineVerdicts" });
  }
}

/** A sample counts only when nothing else loaded the device: a throttled box measures its
 *  throttle, and a download repackage shares the cores. */
export function sampleIsClean(sample: VerdictSample, busy: boolean): boolean {
  return sample.produceSeconds != null && !busy && (sample.thermal === "nominal" || sample.thermal === "fair");
}

/** The verdict `build` recorded under `key` on this device, or null while it stands alone. */
export function storedVerdict(key: string, build: string): EngineVerdict | null {
  const verdict = load()[key];
  const fresh = verdict != null && Date.now() - verdict.at <= VERDICT_TTL_MS;
  return fresh && verdict.app === build && verdict.strikes >= VERDICT_STRIKES ? verdict : null;
}

function strikesFor(key: string, build: string): number {
  const stored = load()[key];
  if (!stored || stored.app !== build || Date.now() - stored.at > VERDICT_TTL_MS) return 0;
  return stored.strikes;
}

/** Records a below-realtime measurement under `key`; the caller has checked the sample is clean. */
export function storeVerdict(key: string, build: string, measured: Omit<EngineVerdict, "app" | "at" | "strikes">): void {
  load()[key] = { app: build, at: Date.now(), ...measured, strikes: strikesFor(key, build) + 1 };
  save();
}

export function clearVerdicts(): void {
  verdicts = {};
  save();
}
