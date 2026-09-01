#!/usr/bin/env node
/**
 * Build docs/playback-coverage.md from the manifest, the fixtures themselves,
 * and one run record per platform.
 *
 * Usage:
 *   node scripts/playback-report.mjs --run tvOS=run-tvos.json --run iPhone=run-iphone.json
 *   node scripts/playback-report.mjs --provenance     rewrite test/playback/provenance.json
 *
 * Every technical column is ffprobed from the fixture at generation time, never
 * read off a filename: several titles name the wrong codec (T05 is DTS, not
 * TrueHD) and the report has to be right where the filename is not.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "test", "playback", "manifest.json");
const PROVENANCE = path.join(ROOT, "test", "playback", "provenance.json");
const SOURCES = path.join(ROOT, "test", "playback", "media-sources.json");
const GENERATOR = path.join(ROOT, "scripts", "make-test-media.mjs");
const OUT = path.join(ROOT, "docs", "playback-coverage.md");
const ROOTS = [path.join(os.homedir(), "Movies", "development-videos"), path.join(os.homedir(), "Music", "Development Audio"), path.join(os.homedir(), "Music", "Development Surround")];

const args = process.argv.slice(2);
const read = (p) => JSON.parse(fs.readFileSync(p, "utf8"));

function fixturePaths() {
  const byTitle = new Map();
  for (const dir of ROOTS) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (/\.(jpg|png|nfo|srt|ass|idx|sub|vtt|txt|md)$/i.test(f)) continue;
      byTitle.set(f.replace(/\.[^.]+$/, ""), path.join(dir, f));
    }
  }
  return byTitle;
}

function probe(file) {
  const j = JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", file], { maxBuffer: 1e8 }));
  const v = j.streams.find((s) => s.codec_type === "video");
  const a = j.streams.find((s) => s.codec_type === "audio");
  const subs = j.streams.filter((s) => s.codec_type === "subtitle");
  return {
    container: path.extname(file).slice(1),
    format: j.format.format_name,
    tags: j.format.tags || {},
    video: v && { codec: v.codec_name, profile: v.profile, w: v.width, h: v.height, pix: v.pix_fmt },
    audio: a && { codec: a.codec_name, profile: a.profile, channels: a.channels, layout: a.channel_layout },
    subtitles: subs.map((s) => s.codec_name),
  };
}

/** Origin is decided by the generator's own tables and the files' tags, never by hand. */
function buildProvenance() {
  const src = fs.readFileSync(GENERATOR, "utf8");
  const table = (name) => {
    const start = src.indexOf(`const ${name} = [`);
    if (start < 0) return [];
    let depth = 0;
    let end = start;
    for (let i = src.indexOf("[", start); i < src.length; i++) {
      if (src[i] === "[") depth++;
      else if (src[i] === "]" && !--depth) {
        end = i;
        break;
      }
    }
    return [...src.slice(start, end).matchAll(/id:\s*"(T\d+)"/g)].map((m) => m[1]);
  };
  const generated = new Set([...table("SYNTHETIC"), ...table("SYNTHETIC_AUDIO"), ...table("COVERAGE"), ...table("COVERAGE_AUDIO")]);
  const sources = read(SOURCES);
  const files = fixturePaths();
  const sintel = new Set(["T07", "T08", "T11"]);
  const items = {};
  for (const it of read(MANIFEST).items) {
    const file = files.get(it.title);
    const tags = file ? Object.values(probe(file).tags).join(" ") : "";
    if (generated.has(it.id)) items[it.id] = { origin: "generated", evidence: "scripts/make-test-media.mjs, lavfi sine + testsrc2 only", redistributable: true };
    else if (sources[it.id]) items[it.id] = { origin: "third-party", evidence: sources[it.id].url, redistributable: false };
    else if (/Cosmos Laundromat/i.test(tags))
      items[it.id] = { origin: "blender-open-movie", evidence: "embedded title tag: Cosmos Laundromat: First Cycle", redistributable: "license version unverified" };
    else if (sintel.has(it.id)) items[it.id] = { origin: "blender-open-movie", evidence: "Sintel, per memories/CLAUDE-testing.md", redistributable: "license version unverified" };
    else if (/Matroska Validation File/i.test(tags))
      items[it.id] = { origin: "matroska-test-suite", evidence: "embedded title tag names the Matroska validation set", redistributable: "license unverified" };
    else items[it.id] = { origin: "unverified", evidence: null, redistributable: false };
  }
  fs.writeFileSync(
    PROVENANCE,
    JSON.stringify(
      {
        note: 'Per-fixture origin, from file tags, the generator source, and media-sources.json. Only origin "generated" may be redistributed as bytes.',
        generatedBy: "scripts/playback-report.mjs --provenance",
        items,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`wrote ${path.relative(ROOT, PROVENANCE)}`);
}

const LANE = { direct: "Direct play", localRemux: "On-device remux", transcode: "Server transcode" };

/** Compact and never mid-word: the raw strings carry a parenthetical runbook. */
function why(problem) {
  if (/packet hashes diverged/.test(problem)) return "baseline hash";
  const slow = problem.match(/position reached ([\d.]+)s, needed (\d+)s/);
  if (slow) return `too slow, ${slow[1]}s of ${slow[2]}s`;
  if (/no probe events/.test(problem)) return "no probe events";
  return problem.replace(/\s*\(.*/, "");
}

function laneCell(item, run) {
  if (!run) return "not run";
  const r = run.results.find((x) => x.id === item.id);
  if (!r) return item.skip ? "skipped" : "not run";
  if (r.actual !== item.mode) return `**wrong lane: ${r.actual}**`;
  if (r.problems?.length) return `fail: ${why(r.problems[0])}`;
  return "pass";
}

function main() {
  if (args.includes("--provenance")) return buildProvenance();

  const runs = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--run") continue;
    const [label, file] = args[i + 1].split("=");
    runs.push({ label, ...read(file) });
  }
  if (!runs.length) {
    console.error("need at least one --run <label>=<path to a --json run record>");
    process.exit(1);
  }

  const manifest = read(MANIFEST);
  const prov = read(PROVENANCE).items;
  const files = fixturePaths();
  const rows = manifest.items.map((it) => {
    const file = files.get(it.title);
    return { item: it, file, probe: file ? probe(file) : null, origin: prov[it.id]?.origin ?? "unverified" };
  });

  const originCounts = {};
  for (const r of rows) originCounts[r.origin] = (originCounts[r.origin] ?? 0) + 1;

  const deep = rows.filter((r) => /10le|10be|12le|p010/.test(r.probe?.video?.pix ?? ""));
  const skipped = manifest.items.filter((it) => it.skip);

  const L = [];
  L.push("# Playback coverage");
  L.push("");
  L.push(
    `Every row below was produced by playing the file through the shipping app on a simulator and reading what the playback engine actually chose, not by consulting a support table. ${manifest.items.length} fixtures, generated ${new Date().toISOString().slice(0, 10)} by \`npm run report:playback\`.`,
  );
  L.push("");
  L.push("The failures are in the table. A coverage page that lists only passes is worth nothing to someone whose file is one of the failures.");
  L.push("");

  L.push("## Results");
  L.push("");
  for (const run of runs) L.push(`- **${run.label}**: ${run.passed}/${run.total} passed, on ${run.simulator}`);
  L.push("");
  L.push(`| ID | Container | Video | Audio | Expected lane | ${runs.map((r) => r.label).join(" | ")} |`);
  L.push(`| --- | --- | --- | --- | --- | ${runs.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    const v = r.probe?.video;
    const a = r.probe?.audio;
    const video = v ? `${v.codec}${/10le|10be|12le/.test(v.pix) ? " 10-bit" : ""} ${v.w}x${v.h}` : "audio only";
    const audio = a ? `${a.codec} ${a.channels}ch` : "none";
    L.push(`| ${r.item.id} | ${r.probe?.container ?? "?"} | ${video} | ${audio} | ${LANE[r.item.mode]} | ${runs.map((run) => laneCell(r.item, run)).join(" | ")} |`);
  }
  L.push("");

  L.push("## What this does not prove");
  L.push("");
  const deepRan = deep.filter((r) => !r.item.skip);
  L.push(
    `**No automated run here exercises 10-bit video.** ${deep.length} fixtures carry a video stream deeper than 8 bits and ${deep.length - deepRan.length} of them are skipped on simulators, each for the reason recorded against it:`,
  );
  L.push("");
  L.push("| ID | Video | Why it is skipped |");
  L.push("| --- | --- | --- |");
  for (const r of deep)
    L.push(`| ${r.item.id} | ${r.probe.video.codec} ${r.probe.video.profile}, ${r.probe.video.pix} | ${r.item.skip ? r.item.skip.replace(/\s+/g, " ") : "not skipped, see the table above"} |`);
  L.push("");
  L.push(
    "Two of those notes record a manual device check rather than a harness result. That is a weaker claim than a green row above, and it is written that way deliberately. `--only <id>` forces any skipped fixture to run on a device build.",
  );
  L.push("");
  if (skipped.length > deep.length) {
    L.push(`${skipped.length} fixtures carry a manifest skip in total. Every reason lives in \`test/playback/manifest.json\`.`);
    L.push("");
  }
  L.push(
    "Results come from simulators. A simulator shares the Mac's decoders and network stack, so it is the right place to prove which lane the engine picks and the wrong place to prove hardware decode.",
  );
  L.push("");

  L.push("## The corpus");
  L.push("");
  L.push(
    `${rows.length} fixtures, ${(rows.reduce((n, r) => n + (r.file ? fs.statSync(r.file).size : 0), 0) / 1e9).toFixed(1)} GB, none of it in git. Origin is recorded per file in [\`test/playback/provenance.json\`](../test/playback/provenance.json), from the generator's own tables and the files' embedded tags:`,
  );
  L.push("");
  L.push("| Origin | Count | Redistributable |");
  L.push("| --- | --- | --- |");
  const redist = {
    generated: "yes, ours outright",
    "blender-open-movie": "attribution required, license version unverified",
    "matroska-test-suite": "license unverified",
    "third-party": "no, linked by URL and checksum only",
    unverified: "no",
  };
  for (const [k, n] of Object.entries(originCounts).sort((a, b) => b[1] - a[1])) L.push(`| \`${k}\` | ${n} | ${redist[k] ?? "unknown"} |`);
  L.push("");
  L.push(
    `Only the \`generated\` set is ours to hand out, and it does not need hosting: \`npm run make:test-media\` rebuilds those from \`lavfi\` sine tones and \`testsrc2\` video, deterministically, from nothing. The third-party files are recorded as URL plus SHA-256 in [\`media-sources.json\`](../test/playback/media-sources.json) and are fetched, never rehosted.`,
  );
  L.push("");

  L.push("## Reproducing this");
  L.push("");
  L.push("```bash");
  L.push("npm run make:test-media          # rebuild the generated fixtures, fetch the linked ones");
  L.push("npm run test:playback:preflight  # eight prerequisites, all server checks authenticated");
  L.push("npm run test:playback -- --udid <UDID> --json run.json");
  L.push("npm run report:playback -- --run tvOS=run.json");
  L.push("```");
  L.push("");
  L.push("Setup, the fixture roots, and what a misconfigured Jellyfin does to a run are in [`test/playback/CLAUDE.md`](../test/playback/CLAUDE.md).");
  L.push("");

  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, L.join("\n"));
  console.log(`wrote ${path.relative(ROOT, OUT)} (${rows.length} fixtures, ${runs.length} platform${runs.length > 1 ? "s" : ""})`);
}

main();
