#!/usr/bin/env node
/**
 * probe-slipstream.mjs — M1 substrate verification for Slipstream
 * (memories/CLAUDE-slipstream.md).
 *
 * Design premise being proven (v2 — playlist adoption): the session grid IS
 * the server's declared segment list. Jellyfin cuts transcode segments at the
 * SOURCE's keyframe positions (identical irregular EXTINFs whatever
 * SegmentLength is requested — verified on the dev server), so the gateway
 * adopts the tier playlist's own segment list and URLs verbatim.
 *
 * Checks:
 *   A. The tier main.m3u8 parses: EXTINF list + per-segment URLs embedding
 *      the server's own runtimeTicks; cumulative EXTINF matches those ticks.
 *   B. Sequential segments (0..2) fetched via the LISTED URLs each start with
 *      an IDR, and their first-PTS deltas match the EXTINF durations.
 *   C. Cold random access: a FRESH PlaySessionId fetching listed segment 10
 *      directly starts with an IDR and carries the same content as the
 *      sequential session's segment 10 (SSIM >= 0.95).
 *   D. Grid stability: the EXTINF list is identical across sessions and
 *      requested SegmentLength values (item-intrinsic, safe to adopt).
 *   E. DELETE /Videos/ActiveEncodings kills the probe's sessions.
 *
 * Usage: node scripts/probe-slipstream.mjs [itemId]
 * Env:   .env.playback-test (JELLYFIN_URL, JELLYFIN_API_KEY). ffprobe+ffmpeg on PATH.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const ENV_PATH = path.join(ROOT, "..", ".env.playback-test");
const TICKS_PER_SEC = 10_000_000;
const PTS_TOLERANCE_SEC = 0.15;

function fail(msg) {
  console.error(`\nNO-GO: ${msg}`);
  process.exit(1);
}

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) fail(`Missing ${ENV_PATH}`);
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  if (!env.JELLYFIN_URL || !env.JELLYFIN_API_KEY) fail("env must define JELLYFIN_URL and JELLYFIN_API_KEY");
  return env;
}

const env = loadEnv();
const BASE = env.JELLYFIN_URL.replace(/\/$/, "");
const HEADERS = { "X-Emby-Token": env.JELLYFIN_API_KEY };

const jf = (p, init = {}) => fetch(`${BASE}${p}`, { headers: HEADERS, ...init });

function tierParams(playSessionId, mediaSourceId, segLen = 6) {
  return (
    `MediaSourceId=${mediaSourceId}&VideoCodec=h264&AudioCodec=aac` +
    `&VideoBitrate=1500000&AudioBitrate=128000&MaxWidth=854` +
    `&SegmentContainer=ts&SegmentLength=${segLen}&MinSegments=1` +
    `&BreakOnNonKeyFrames=false&TranscodingMaxAudioChannels=2` +
    `&PlaySessionId=${playSessionId}`
  );
}

/** Parse a media playlist into [{duration, url, runtimeTicks}]. */
function parsePlaylist(text) {
  const lines = text.split("\n");
  const segs = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^#EXTINF:([\d.]+)/);
    if (m) {
      const url = lines[i + 1]?.trim();
      const ticks = url?.match(/runtimeTicks=(\d+)/)?.[1];
      segs.push({ duration: parseFloat(m[1]), url, runtimeTicks: ticks ? Number(ticks) : null });
    }
  }
  return segs;
}

function ffprobeKeyframes(file) {
  // JSON output: CSV emits fields in ffprobe's canonical order, not the
  // requested one — that bug produced a false NO-GO in probe v1.
  const out = execFileSync("ffprobe", ["-v", "quiet", "-select_streams", "v:0", "-show_frames", "-show_entries", "frame=pts_time,key_frame", "-of", "json", file], { encoding: "utf8" });
  return (JSON.parse(out).frames ?? []).map((f) => ({ pts: parseFloat(f.pts_time), key: f.key_frame === 1 }));
}

function ssimScore(fileA, fileB) {
  // Content identity between two encodes of the same params: ffmpeg's mean SSIM
  // (logged on stderr, so capture via shell).
  const res = execFileSync("sh", ["-c", `ffmpeg -i "${fileA}" -i "${fileB}" -lavfi ssim -f null - 2>&1 | grep "SSIM" | tail -1`], { encoding: "utf8" });
  const m = res.match(/All:\s*([\d.]+)/);
  return m ? parseFloat(m[1]) : null;
}

async function fetchListed(seg, playSessionId, outDir, tag) {
  // Playlist URLs are relative to /Videos/{id}/main.m3u8; swap in our session id.
  const url = seg.url.replace(/PlaySessionId=[^&]+/, `PlaySessionId=${playSessionId}`);
  const started = Date.now();
  const res = await jf(`/Videos/${ITEM_ID}/${url}`);
  if (!res.ok) return { ok: false, status: res.status };
  const buf = Buffer.from(await res.arrayBuffer());
  const file = path.join(outDir, `${tag}.ts`);
  fs.writeFileSync(file, buf);
  return { ok: true, file, bytes: buf.length, ms: Date.now() - started };
}

let ITEM_ID;

async function main() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "slipstream-probe-"));
  const results = [];
  const push = (check, pass, detail) => {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check}  (${detail})`);
  };

  ITEM_ID = process.argv[2];
  if (!ITEM_ID) {
    const data = await (await jf(`/Items?Recursive=true&IncludeItemTypes=Movie,Video&Limit=5&SortBy=RunTimeTicks&SortOrder=Descending&fields=MediaSources`)).json();
    const item = data.Items?.find((i) => (i.RunTimeTicks ?? 0) > 120 * TICKS_PER_SEC);
    if (!item) fail("no item >=120s found; pass an itemId");
    ITEM_ID = item.Id;
    console.log(`Item: ${item.Name} (${ITEM_ID}), runtime ${(item.RunTimeTicks / TICKS_PER_SEC / 60).toFixed(1)} min\n`);
  }
  const detail = await (await jf(`/Items/${ITEM_ID}?fields=MediaSources`)).json().catch(() => null);
  const msId = detail?.MediaSources?.[0]?.Id ?? ITEM_ID;

  // --- A: tier playlist parses with embedded ticks ---
  const sessionA = `slipstream-a-${Date.now()}`;
  const plA = await (await jf(`/Videos/${ITEM_ID}/main.m3u8?${tierParams(sessionA, msId)}`)).text();
  const segsA = parsePlaylist(plA);
  push("tier playlist parses", segsA.length > 12, `${segsA.length} segments`);
  const ticksOk = segsA.slice(0, 12).every((s, i) => {
    const cum = segsA.slice(0, i).reduce((a, x) => a + x.duration, 0);
    return s.runtimeTicks != null && Math.abs(s.runtimeTicks / TICKS_PER_SEC - cum) < 0.02;
  });
  push("URLs embed cumulative runtimeTicks", ticksOk, "first 12 segments match cumulative EXTINF");

  // --- B: sequential segments via LISTED URLs ---
  let prevFirstPts = null;
  for (const n of [0, 1, 2]) {
    const seg = await fetchListed(segsA[n], sessionA, outDir, `a-seg${n}`);
    push(`seq seg${n} fetch`, seg.ok, seg.ok ? `${seg.bytes} bytes in ${seg.ms}ms` : `status ${seg.status}`);
    if (!seg.ok) continue;
    const frames = ffprobeKeyframes(seg.file);
    push(`seq seg${n} starts with IDR`, frames[0]?.key === true, `first pts=${frames[0]?.pts.toFixed(3)}`);
    if (n > 0 && prevFirstPts != null) {
      const delta = frames[0].pts - prevFirstPts;
      push(`seq seg${n} delta matches EXTINF`, Math.abs(delta - segsA[n - 1].duration) <= PTS_TOLERANCE_SEC, `delta=${delta.toFixed(3)} vs EXTINF=${segsA[n - 1].duration}`);
    }
    prevFirstPts = frames[0]?.pts ?? null;
    segsA[n].file = seg.file;
  }
  // Also grab seg10 on session A for the content-identity comparison.
  const a10 = await fetchListed(segsA[10], sessionA, outDir, "a-seg10");
  push("session A seg10 fetch (gap restart)", a10.ok, a10.ok ? `${a10.bytes} bytes in ${a10.ms}ms` : `status ${a10.status}`);

  // --- C: cold random access on a fresh session ---
  const sessionB = `slipstream-b-${Date.now()}`;
  const b10 = await fetchListed(segsA[10], sessionB, outDir, "b-seg10");
  push("cold seg10 fetch", b10.ok, b10.ok ? `${b10.bytes} bytes in ${b10.ms}ms` : `status ${b10.status}`);
  if (b10.ok) {
    const frames = ffprobeKeyframes(b10.file);
    push("cold seg10 starts with IDR", frames[0]?.key === true, `first pts=${frames[0]?.pts.toFixed(3)}`);
    if (a10.ok) {
      const score = ssimScore(a10.file, b10.file);
      push("cold seg10 content identity (SSIM)", score != null && score >= 0.95, `SSIM=${score}`);
    }
  }

  // --- D: grid stability across sessions and params ---
  const plC = await (await jf(`/Videos/${ITEM_ID}/main.m3u8?${tierParams(`slipstream-c-${Date.now()}`, msId, 4)}`)).text();
  const segsC = parsePlaylist(plC);
  const stable = segsA.length === segsC.length && segsA.slice(0, 20).every((s, i) => Math.abs(s.duration - segsC[i].duration) < 0.001);
  push("grid stable across sessions/params", stable, `SegmentLength=6 vs 4: ${segsA.length}/${segsC.length} segments`);

  // --- E: kill ---
  const killA = (await jf(`/Videos/ActiveEncodings?deviceId=slipstream-probe&playSessionId=${sessionA}`, { method: "DELETE" })).status;
  const killB = (await jf(`/Videos/ActiveEncodings?deviceId=slipstream-probe&playSessionId=${sessionB}`, { method: "DELETE" })).status;
  push("DELETE /Videos/ActiveEncodings", [200, 204].includes(killA) && [200, 204].includes(killB), `status ${killA}/${killB}`);

  const go = results.every((r) => r.pass);
  console.log(`\nSegments kept in ${outDir}`);
  console.log(go ? "\nVERDICT: GO — playlist-adoption grid holds on this server" : "\nVERDICT: NO-GO — see failures above");
  process.exit(go ? 0 : 1);
}

main().catch((e) => fail(e.stack ?? e.message));
