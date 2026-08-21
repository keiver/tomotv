/** The app's own tokens, read from constants/colors.ts so the two cannot drift. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const src = fs.readFileSync(path.join(ROOT, "constants", "colors.ts"), "utf8");

export const COLORS = Object.fromEntries([...src.matchAll(/^\s{2}([A-Z_]+):\s*"(#[0-9A-Fa-f]{6,8})"/gm)].map((m) => [m[1], m[2]]));

for (const need of ["ACCENT", "ON_ACCENT_WARM", "SURFACE_SUNKEN", "BACKGROUND_DEEP", "TEXT_SECONDARY"]) {
  if (!COLORS[need]) throw new Error(`constants/colors.ts no longer defines ${need}`);
}
