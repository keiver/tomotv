/**
 * Tomo's keys over the engine's verdict store (@keiver/tomo-engine): item ids repeat across
 * servers, so the server is part of the key, and the running build stamps every verdict.
 */
import { APP_BUILD_LABEL } from "@/constants/app";
import { getConfig } from "@/services/jellyfin/session";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { sampleIsClean, storedVerdict, storeVerdict, type EngineVerdict, type VerdictSample } from "@keiver/tomo-engine";

export { clearVerdicts, sampleIsClean, VERDICT_STRIKES, VERDICT_TTL_MS, VERDICTS_FILENAME, type EngineVerdict } from "@keiver/tomo-engine";

type VerdictItem = Pick<JellyfinVideoItem, "Id" | "MediaSources">;

export function verdictKey(server: string, item: VerdictItem): string {
  return `${server}:${item.Id}:${item.MediaSources?.[0]?.Id ?? ""}`;
}

/** The verdict this build recorded for the item on this device, or null while it stands alone.
 *  Never throws: a config read that fails (locked device, cold launch) must not block the lane pick. */
export async function rememberedVerdict(item: VerdictItem): Promise<EngineVerdict | null> {
  try {
    const { server } = await getConfig();
    return storedVerdict(verdictKey(server, item), APP_BUILD_LABEL);
  } catch (error) {
    logger.warn("Engine verdict lookup failed", error, { service: "EngineVerdicts" });
    return null;
  }
}

/** Records a below-realtime measurement; false when the sample was not clean enough to keep. */
export async function recordVerdict(item: VerdictItem, sample: VerdictSample, reason: string, { busy }: { busy: boolean }): Promise<boolean> {
  if (!sampleIsClean(sample, busy)) return false;
  try {
    const { server } = await getConfig();
    storeVerdict(verdictKey(server, item), APP_BUILD_LABEL, { reason, produceSeconds: sample.produceSeconds as number, segmentSeconds: sample.segmentSeconds, thermal: sample.thermal });
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
    storeVerdict(verdictKey(server, item), APP_BUILD_LABEL, { reason: `no segment within ${deadlineSeconds}s`, produceSeconds: deadlineSeconds, segmentSeconds: 0, thermal: "unknown" });
    return true;
  } catch (error) {
    logger.warn("Engine verdict record failed", error, { service: "EngineVerdicts" });
    return false;
  }
}
