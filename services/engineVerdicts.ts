/**
 * engineVerdicts.ts
 *
 * What the engine measured about a file on this device. A session that ran below realtime is
 * remembered, and once two of them agree the next play takes the server lane from the first
 * request. Two, because a segment's time includes reading the source, so one slow measurement can
 * be the link rather than the device. A verdict from another app build does not count.
 */
import { APP_BUILD_LABEL } from "@/constants/app";
import { getConfig } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { File, Paths } from "expo-file-system";

/** The regression driver deletes this from the app container before every item. */
export const VERDICTS_FILENAME = "engine-verdicts.json";

/** Measurements that agreed before a file is held to the server lane. */
export const VERDICT_STRIKES = 2;

export type EngineVerdict = { app: string; at: number; reason: string; produceSeconds: number; segmentSeconds: number; thermal: string; strikes: number };

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

/** The verdict this build recorded for the item on this device, or null while it stands alone.
 *  Never throws: a config read that fails (locked device, cold launch) must not block the lane pick. */
export async function rememberedVerdict(item: VerdictItem): Promise<EngineVerdict | null> {
  try {
    const { server } = await getConfig();
    const verdict = load()[verdictKey(server, item)];
    return verdict && verdict.app === APP_BUILD_LABEL && verdict.strikes >= VERDICT_STRIKES ? verdict : null;
  } catch (error) {
    logger.warn("Engine verdict lookup failed", error, { service: "EngineVerdicts" });
    return null;
  }
}

function strikesFor(key: string): number {
  const stored = load()[key];
  return stored?.app === APP_BUILD_LABEL ? stored.strikes : 0;
}

/** Records a below-realtime measurement; false when the sample was not clean enough to keep. */
export async function recordVerdict(item: VerdictItem, sample: VerdictSample, reason: string, { busy }: { busy: boolean }): Promise<boolean> {
  if (!sampleIsClean(sample, busy)) return false;
  try {
    const { server } = await getConfig();
    const key = verdictKey(server, item);
    load()[key] = {
      app: APP_BUILD_LABEL,
      at: Date.now(),
      reason,
      produceSeconds: sample.produceSeconds as number,
      segmentSeconds: sample.segmentSeconds,
      thermal: sample.thermal,
      strikes: strikesFor(key) + 1,
    };
    save();
    return true;
  } catch (error) {
    logger.warn("Engine verdict record failed", error, { service: "EngineVerdicts" });
    return false;
  }
}

/** No segment at all within the engine's deadline: a measurement with no sample to carry. Thermal
 *  state is unknown here, so only a running repackage disqualifies it. */
export async function recordTimeoutVerdict(item: VerdictItem, deadlineSeconds: number, { busy }: { busy: boolean }): Promise<boolean> {
  if (busy) return false;
  try {
    const { server } = await getConfig();
    const key = verdictKey(server, item);
    load()[key] = {
      app: APP_BUILD_LABEL,
      at: Date.now(),
      reason: `no segment within ${deadlineSeconds}s`,
      produceSeconds: deadlineSeconds,
      segmentSeconds: 0,
      thermal: "unknown",
      strikes: strikesFor(key) + 1,
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
