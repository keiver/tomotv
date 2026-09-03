/**
 * engineVerdicts.ts
 *
 * What the engine measured about a file on this device. A session that ran below realtime is
 * remembered, and the next play of that file takes the server lane from the first request.
 * One file under Documents, read once; a verdict from another app build does not count, since
 * a new engine build earns a new try.
 */
import { APP_BUILD_LABEL } from "@/constants/app";
import { getConfig } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { File, Paths } from "expo-file-system";

/** The regression driver deletes this from the app container before every item. */
export const VERDICTS_FILENAME = "engine-verdicts.json";

export type EngineVerdict = { app: string; at: number; reason: string; produceSeconds: number; segmentSeconds: number; thermal: string };

type VerdictSample = { produceSeconds?: number; segmentSeconds: number; thermal: string };
type VerdictItem = Pick<JellyfinVideoItem, "Id" | "MediaSources">;

let verdicts: Record<string, EngineVerdict> | null = null;

function verdictsFile(): File {
  return new File(Paths.document, VERDICTS_FILENAME);
}

function load(): Record<string, EngineVerdict> {
  if (verdicts) return verdicts;
  try {
    const file = verdictsFile();
    verdicts = file.exists ? (JSON.parse(file.textSync()) as Record<string, EngineVerdict>) : {};
  } catch (error) {
    logger.warn("Engine verdicts read failed", error, { service: "EngineVerdicts" });
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
    logger.warn("Engine verdicts write failed", error, { service: "EngineVerdicts" });
  }
}

/** Item ids repeat across servers, so the server is part of the key. */
export function verdictKey(server: string, item: VerdictItem): string {
  return `${server}:${item.Id}:${item.MediaSources?.[0]?.Id ?? ""}`;
}

/** A sample counts only when nothing else loaded the device: a throttled box measures its
 *  throttle, and a download repackage shares the cores. */
export function sampleIsClean(sample: VerdictSample, busy: boolean): boolean {
  return sample.produceSeconds != null && !busy && (sample.thermal === "nominal" || sample.thermal === "fair");
}

/** The verdict this build recorded for the item on this device, or null. Never throws:
 *  a config read that fails (locked device, cold launch) must not block the lane pick. */
export async function rememberedVerdict(item: VerdictItem): Promise<EngineVerdict | null> {
  try {
    const { server } = await getConfig();
    const verdict = load()[verdictKey(server, item)];
    return verdict && verdict.app === APP_BUILD_LABEL ? verdict : null;
  } catch (error) {
    logger.warn("Engine verdict lookup failed", error, { service: "EngineVerdicts" });
    return null;
  }
}

/** Remembers a below-realtime sample; false when the sample was not clean enough to keep. */
export async function recordVerdict(item: VerdictItem, sample: VerdictSample, reason: string, { busy }: { busy: boolean }): Promise<boolean> {
  if (!sampleIsClean(sample, busy)) return false;
  try {
    const { server } = await getConfig();
    load()[verdictKey(server, item)] = {
      app: APP_BUILD_LABEL,
      at: Date.now(),
      reason,
      produceSeconds: sample.produceSeconds as number,
      segmentSeconds: sample.segmentSeconds,
      thermal: sample.thermal,
    };
    save();
    return true;
  } catch (error) {
    logger.warn("Engine verdict record failed", error, { service: "EngineVerdicts" });
    return false;
  }
}

/** No segment at all within the engine's deadline: a verdict with no sample to carry. Thermal
 *  state is unknown here, so only a running repackage disqualifies it. */
export async function recordTimeoutVerdict(item: VerdictItem, deadlineSeconds: number, { busy }: { busy: boolean }): Promise<boolean> {
  if (busy) return false;
  try {
    const { server } = await getConfig();
    load()[verdictKey(server, item)] = {
      app: APP_BUILD_LABEL,
      at: Date.now(),
      reason: `no segment within ${deadlineSeconds}s`,
      produceSeconds: deadlineSeconds,
      segmentSeconds: 0,
      thermal: "unknown",
    };
    save();
    return true;
  } catch (error) {
    logger.warn("Engine verdict record failed", error, { service: "EngineVerdicts" });
    return false;
  }
}

export function clearVerdicts(): void {
  verdicts = {};
  save();
}
