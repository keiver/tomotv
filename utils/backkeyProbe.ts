/**
 * [backkey] Dev-only diagnostics for the Menu/back-key investigation: a no-op
 * outside __DEV__. Records focus events to Documents/backkey-probe.jsonl so
 * they can be read from the app container (same pattern as services/playbackProbe.ts).
 */
import { File, Paths } from "expo-file-system";
import { logger } from "@/utils/logger";

const FILENAME = "backkey-probe.jsonl";
let lines: string[] = [];

export function backkeyProbe(event: string, context?: Record<string, unknown>): void {
  if (!__DEV__) return;
  logger.debug(`[backkey] ${event}`, context);
  lines.push(JSON.stringify({ t: new Date().toISOString(), event, ...context }));
  if (lines.length > 500) lines = lines.slice(-400);
  try {
    new File(Paths.document, FILENAME).write(lines.join("\n") + "\n");
  } catch {
    // diagnostics only — never let the probe throw into app code
  }
}
