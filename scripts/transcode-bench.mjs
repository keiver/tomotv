#!/usr/bin/env node
/**
 * Transcode bench driver. Opens tomotv://dev-bench (app/dev-bench.tsx) on a booted simulator
 * or a paired device; the app runs each rung through VideoTranscoder.benchmark, decode + encode
 * and then decode only, and writes a record this reads back and prints as one table.
 *
 *   npm run bench:transcode                              booted simulator: a tooling check only,
 *                                                        the decoders run on this Mac's cores
 *   npm run bench:transcode -- --device "Main Bedroom"   paired device, by devicectl name
 *   npm run bench:transcode -- --only B03,B07 --seconds 45 --no-decode --udid <UDID> --json <path>
 *
 * Fixtures: `npm run make:test-media -- --bench` builds B01-B09 from the T40 8K source. The
 * simulator is signed in through tomotv://dev-session when the env names a user; a device keeps
 * its own account and must already be on JELLYFIN_URL's server. Records land in
 * test/playback/bench/<device>-<date>.json.
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { loadEnv, pickSimulator, resolveItems, signInApp, simctl } from "./playback-regression.mjs";

const exec = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "test", "playback", "bench");
// xcode-select points at CommandLineTools on the dev Mac, so `xcrun devicectl` finds nothing.
const DEVICECTL = "/Applications/Xcode.app/Contents/Developer/usr/bin/devicectl";
const RECORD = "Library/Caches/transcode-bench.json";

/** T21 is the file behind the original 7.63x figure, T40 the 8K that "failed outright". */
const RUNGS = [
  "T21 DEVTC VP9 Opus 2048x858",
  "B01 BENCH VP9 1080p",
  "B02 BENCH VP9 1440p",
  "B03 BENCH VP9 2160p",
  "B04 BENCH VP9 2160p 10bit",
  "B05 BENCH AV1 1080p",
  "B06 BENCH AV1 1440p",
  "B07 BENCH AV1 2160p",
  "B08 BENCH AV1 2160p 10bit",
  "B09 BENCH MPEG2 1080i",
  "T40 SERVER VP9 8K gate-reject",
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

const devicectl = (cmdArgs) => exec(DEVICECTL, cmdArgs, { timeout: 120000 });

function readRecord(file, run) {
  try {
    const record = JSON.parse(fs.readFileSync(file, "utf8"));
    return record.run === run ? record : null;
  } catch {
    return null;
  }
}

const x = (result) => (result ? (result.failed ? `FAIL ${result.failed}` : `${result.realtime.toFixed(2)}x`) : "-");

function printTable(record, isSimulator) {
  const first = record.rows.find((row) => row.full)?.full;
  console.log(`\n${"=".repeat(120)}`);
  console.log(`${first?.device ?? "unknown"}  ${first?.build ?? "?"} build  ${first?.cores ?? "?"} cores  ${record.os}  ${record.app}`);
  if (isSimulator) console.log("SIMULATOR: these decoders ran on this Mac. The numbers prove the tooling, not a device.");
  console.log(
    `${"ID".padEnd(5)}${"CODEC".padEnd(11)}${"SIZE".padEnd(11)}${"PIXFMT".padEnd(13)}${"FULL".padEnd(9)}${"DECODE".padEnd(9)}${"WINDOWS fps".padEnd(16)}${"THERMAL".padEnd(18)}${"CONV".padEnd(13)}DECODER`,
  );
  for (const row of record.rows) {
    const id = row.title.split(" ")[0];
    if (row.error) {
      console.log(`${id.padEnd(5)}ERROR ${row.error}`);
      continue;
    }
    const shape = row.full ?? row.decode ?? {};
    const windows = row.full?.windows?.length ? `${row.full.windows[0].toFixed(0)}>${row.full.windows[row.full.windows.length - 1].toFixed(0)}` : "-";
    const thermal = row.full ? `${row.full.thermalBefore}>${row.full.thermalAfter}` : "-";
    console.log(
      `${id.padEnd(5)}${String(shape.codec ?? "?").padEnd(11)}${`${shape.width ?? 0}x${shape.height ?? 0}`.padEnd(11)}${String(shape.pixFmt ?? "?").padEnd(13)}${x(row.full).padEnd(9)}${x(row.decode).padEnd(9)}${windows.padEnd(16)}${thermal.padEnd(18)}${String(row.full?.conversion ?? "-").padEnd(13)}${shape.decoder ?? "?"}`,
    );
  }
}

async function main() {
  const env = loadEnv();
  const only = opt("--only")
    ?.split(",")
    .map((s) => s.trim().toUpperCase());
  const titles = RUNGS.filter((title) => !only || only.includes(title.split(" ")[0]));
  if (!titles.length) fail("No rung matches --only");
  const seconds = Number(opt("--seconds")) > 0 ? Number(opt("--seconds")) : 45;
  const decode = !flag("--no-decode");
  const device = opt("--device");
  const run = String(Date.now());

  console.log("Resolving rungs in Jellyfin...");
  const ids = await resolveItems(
    env,
    titles.map((title) => ({ title })),
  );
  const query = new URLSearchParams({ items: titles.map((title) => ids.get(title).id).join(","), seconds: String(seconds), decode: decode ? "1" : "0", run });
  const url = `tomotv://dev-bench?${query}`;

  const local = path.join(os.tmpdir(), `tomotv-bench-${run}.json`);
  let fetchRecord;
  if (device) {
    const { stdout } = await devicectl(["list", "devices"]).catch((e) => fail(`devicectl failed: ${e.message}`));
    if (!stdout.includes(device)) fail(`No paired device named "${device}". Paired:\n${stdout}`);
    console.log(`Device: ${device}`);
    await devicectl(["device", "process", "launch", "--device", device, "--terminate-existing", "--payload-url", url, env.BUNDLE_ID]).catch((e) => fail(`launch failed: ${e.stderr || e.message}`));
    fetchRecord = async () => {
      fs.rmSync(local, { force: true });
      await devicectl(["device", "copy", "from", "--device", device, "--domain-type", "appDataContainer", "--domain-identifier", env.BUNDLE_ID, "--source", RECORD, "--destination", local]).catch(
        () => {},
      );
      return readRecord(local, run);
    };
  } else {
    const sim = await pickSimulator().catch((e) => fail(e.message));
    await simctl(["get_app_container", sim.udid, env.BUNDLE_ID, "app"]).catch(() => fail(`${env.BUNDLE_ID} is not installed on ${sim.name}. Build it first (npm run ios / npm run both).`));
    console.log(`Simulator: ${sim.name} (${sim.udid})`);
    const { stdout: container } = await simctl(["get_app_container", sim.udid, env.BUNDLE_ID, "data"]);
    const recordPath = path.join(container.trim(), RECORD);
    fs.rmSync(recordPath, { force: true });
    // Same warm-up the suite does: a dev build's first launch pays the Metro bundle download.
    await simctl(["terminate", sim.udid, env.BUNDLE_ID]).catch(() => {});
    await simctl(["launch", sim.udid, env.BUNDLE_ID]).catch(() => {});
    await sleep(15000);
    await signInApp(env, sim);
    await simctl(["openurl", sim.udid, url]);
    fetchRecord = async () => readRecord(recordPath, run);
  }
  console.log(`Opened ${url}`);
  console.log(`Jellyfin: ${env.JELLYFIN_URL}\n`);

  const passes = decode ? 2 : 1;
  const deadline = Date.now() + (titles.length * seconds * passes + 240) * 1000;
  let record = null;
  let printed = 0;
  while (Date.now() < deadline) {
    await sleep(5000);
    record = await fetchRecord();
    if (!record) continue;
    for (const row of record.rows.slice(printed)) console.log(`  ${row.error ? `ERROR ${row.title}: ${row.error}` : `${row.title}: full ${x(row.full)}, decode ${x(row.decode)}`}`);
    printed = record.rows.length;
    if (record.done) break;
  }
  if (!record) fail('The app never wrote a bench record. A fresh install needs one click on tvOS\'s "Open in Tomo TV?" dialog; a device must be signed in to the same server.');
  if (!record.done) console.warn(`\nTimed out with ${record.rows.length}/${titles.length} rungs recorded.`);

  const first = record.rows.find((row) => row.full)?.full;
  const model = first?.device ?? "unknown";
  const isSimulator = !/^(AppleTV|iPhone|iPad)/.test(model);
  printTable(record, isSimulator);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const jsonPath = opt("--json") ?? path.join(OUT_DIR, `${isSimulator ? "simulator" : model}-${stamp}.json`);
  fs.writeFileSync(jsonPath, `${JSON.stringify({ server: env.JELLYFIN_URL, seconds, ...record }, null, 2)}\n`);
  console.log(`\nWrote ${path.relative(ROOT, jsonPath)}`);
}

main().catch((e) => fail(e.stack || String(e)));
