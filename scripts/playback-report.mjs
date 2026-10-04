#!/usr/bin/env node
/**
 * Build docs/playback-coverage.md from the manifest, the fixtures themselves,
 * and one run record per platform, and docs/playback-fixtures.{md,html} from the fixtures alone.
 *
 * Usage:
 *   node scripts/playback-report.mjs --run tvOS=run-tvos.json --run iPhone=run-iphone.json
 *   node scripts/playback-report.mjs --fixtures       rewrite docs/playback-fixtures.{md,html} only
 *   node scripts/playback-report.mjs --provenance     rewrite test/playback/provenance.json
 *
 * Every technical column is ffprobed from the fixture at generation time, never
 * read off a filename: several titles name the wrong codec (T05 is DTS, not
 * TrueHD) and the report has to be right where the filename is not.
 */
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cell, formatRows, mainVideo, streamRows, streamTable, summaryCells } from "./lib/fixture-facts.mjs";
import { fixturesPage } from "./lib/fixtures-page.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = path.join(ROOT, "test", "playback", "manifest.json");
const PROVENANCE = path.join(ROOT, "test", "playback", "provenance.json");
const SOURCES = path.join(ROOT, "test", "playback", "media-sources.json");
const GENERATOR = path.join(ROOT, "scripts", "make-test-media.mjs");
const OUT = path.join(ROOT, "docs", "playback-coverage.md");
const FIXTURES_OUT = path.join(ROOT, "docs", "playback-fixtures.md");
const FIXTURES_HTML = path.join(ROOT, "docs", "playback-fixtures.html");
const LIVE_PLAYLIST = path.join(ROOT, "test", "playback", "live", "real.m3u");
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

const ffprobe = (file, extra) => JSON.parse(execFileSync("ffprobe", ["-v", "quiet", "-print_format", "json", ...extra, file], { maxBuffer: 1e8 }));

function probe(file) {
  const j = ffprobe(file, ["-show_format", "-show_streams", "-show_chapters"]);
  const v = mainVideo(j);
  const a = j.streams.find((s) => s.codec_type === "audio");
  const subs = j.streams.filter((s) => s.codec_type === "subtitle");
  // Scan type and HDR metadata (mastering display, light level, DV RPU) live on frames, not the stream.
  const frameEntries = "frame=interlaced_frame,top_field_first,side_data_list";
  const firstFrame = v ? ffprobe(file, ["-select_streams", String(v.index), "-read_intervals", "%+#1", "-show_frames", "-show_entries", frameEntries]).frames?.[0] : undefined;
  return {
    container: path.extname(file).slice(1),
    format: j.format.format_name,
    tags: j.format.tags || {},
    video: v && { codec: v.codec_name, profile: v.profile, w: v.width, h: v.height, pix: v.pix_fmt },
    audio: a && { codec: a.codec_name, profile: a.profile, channels: a.channels, layout: a.channel_layout },
    subtitles: subs.map((s) => s.codec_name),
    raw: j,
    firstFrame,
  };
}

function sha256(file) {
  const hash = crypto.createHash("sha256");
  const buf = Buffer.alloc(1 << 24);
  const fd = fs.openSync(file, "r");
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) hash.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

/** Subtitle files Jellyfin attaches: the name starts with the video's full name, then a dot. */
function sidecars(file) {
  const dir = path.dirname(file);
  const stem = path.basename(file).replace(/\.[^.]+$/, "");
  return fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${stem}.`) && /\.(srt|ass|ssa|vtt|sub|idx|sup|smi)$/i.test(f))
    .map((name) => {
      const p = path.join(dir, name);
      let codec;
      try {
        codec = ffprobe(p, ["-show_streams"]).streams[0]?.codec_name;
      } catch {}
      return { name, bytes: fs.statSync(p).size, sha256: sha256(p), codec };
    });
}

function collect(manifest) {
  const prov = read(PROVENANCE).items;
  const files = fixturePaths();
  return manifest.items.map((it) => {
    const file = it.live ? undefined : files.get(it.title);
    return { item: it, file, probe: file ? probe(file) : null, sidecars: file ? sidecars(file) : [], origin: prov[it.id]?.origin ?? "unverified", provenance: prov[it.id] };
  });
}

/** Everything ffprobe reports about each fixture, so a reader without the files can see what was played. */
function buildFixtures(manifest, rows) {
  const version = execFileSync("ffprobe", ["-version"], { encoding: "utf8" }).split("\n")[0];
  const m3u = fs.readFileSync(LIVE_PLAYLIST, "utf8").split("\n");
  const origins = new Map();
  m3u.forEach((line, i) => line.startsWith("#EXTINF") && origins.set(line.slice(line.lastIndexOf(",") + 1).trim(), m3u[i + 1]?.trim()));
  const lede = `Every file the playback suite plays, as ${version.replace(/ Copyright.*/, "")} reads it, generated ${new Date().toISOString().slice(0, 10)}. Stream facts are ffprobe's, scan type and HDR metadata come from the first decoded video frame, and the SHA-256 identifies the exact bytes described.`;
  const fixtures = rows.map((r) => {
    const it = r.item;
    const f = { id: it.id, title: it.title };
    if (it.live)
      return {
        ...f,
        live: { url: origins.get(it.title) },
        expectLine: `Expected lane: ${LANE[it.mode]}, validate ${it.validate}${it.expect ? `, harness expects ${JSON.stringify(it.expect)}` : ""}.`,
      };
    if (!r.file) return f;
    // [label, value, monospace]
    const facts = [
      ["File", path.basename(r.file), true],
      ["Size", `${fs.statSync(r.file).size.toLocaleString("en-US")} bytes`],
      ["SHA-256", sha256(r.file), true],
      ...formatRows(r.probe.raw),
      ["Origin", `${r.origin}${r.provenance?.evidence ? `, ${r.provenance.evidence}` : ""}`],
      ["Expected lane", `${LANE[it.mode]}, validate ${it.validate}`],
    ];
    if (it.expect) facts.push(["Harness expects", JSON.stringify(it.expect), true]);
    if (it.skip) facts.push(["Skipped", it.skip.replace(/\s+/g, " ")]);
    return { ...f, facts, streams: streamRows(r.probe.raw, r.probe.firstFrame), sidecars: r.sidecars, probe: r.probe };
  });

  const L = [
    "# Playback fixtures",
    "",
    `${lede} Browsable with a codec index in [\`playback-fixtures.html\`](playback-fixtures.html); results per file are in [\`playback-coverage.md\`](playback-coverage.md).`,
    "",
  ];
  for (const f of fixtures) {
    L.push(`### ${f.id}`, "");
    if (f.live) {
      L.push(
        `Live TV channel **${cell(f.title)}**, ${f.live.url ? `origin \`${f.live.url}\` in` : "not found in"} [\`test/playback/live/real.m3u\`](../test/playback/live/real.m3u). Not a file: its streams are whatever the origin sends at run time, so nothing here is probed.`,
        "",
        f.expectLine,
        "",
      );
      continue;
    }
    if (!f.facts) {
      L.push(`**${cell(f.title)}**: no file with this title under the fixture roots, so nothing is probed.`, "");
      continue;
    }
    L.push("| | |", "| --- | --- |");
    for (const [k, val, code] of f.facts) L.push(`| ${k} | ${code ? `\`${val}\`` : cell(val)} |`);
    L.push("", ...streamTable(f.probe.raw, f.probe.firstFrame, f.sidecars), "");
  }
  fs.mkdirSync(path.dirname(FIXTURES_OUT), { recursive: true });
  fs.writeFileSync(FIXTURES_OUT, L.join("\n"));
  fs.writeFileSync(FIXTURES_HTML, fixturesPage({ lede, fixtures }));
  console.log(
    `wrote ${path.relative(ROOT, FIXTURES_OUT)} and ${path.relative(ROOT, FIXTURES_HTML)} (${rows.filter((r) => r.file).length} files, ${rows.filter((r) => r.item.live).length} live channels)`,
  );
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
  const manifest = read(MANIFEST);
  if (args.includes("--fixtures")) return buildFixtures(manifest, collect(manifest));

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

  const rows = collect(manifest);
  buildFixtures(manifest, rows);
  const fileRows = rows.filter((r) => !r.item.live);
  const liveCount = rows.length - fileRows.length;

  const originCounts = {};
  for (const r of fileRows) originCounts[r.origin] = (originCounts[r.origin] ?? 0) + 1;

  const deep = rows.filter((r) => /10le|10be|12le|p010/.test(r.probe?.video?.pix ?? ""));
  const skipped = manifest.items.filter((it) => it.skip);

  const L = [];
  L.push("# Playback coverage");
  L.push("");
  L.push(
    `Every result cell below is what the shipping app reported when the harness played that file on a simulator, or the reason it did not run; none of it comes from a support table. ${fileRows.length} files and ${liveCount} live channels, each described stream by stream in [\`playback-fixtures.md\`](playback-fixtures.md), generated ${new Date().toISOString().slice(0, 10)} by \`npm run report:playback\`.`,
  );
  L.push("");
  L.push("The failures are in the table. A coverage page that lists only passes is worth nothing to someone whose file is one of the failures.");
  L.push("");

  L.push("## Results");
  L.push("");
  for (const run of runs) L.push(`- **${run.label}**: ${run.passed}/${run.total} passed, on ${run.target ?? run.simulator}`);
  L.push("");
  L.push(`| ID | File | Container | Video | Audio | Subtitles | Expected lane | ${runs.map((r) => r.label).join(" | ")} |`);
  L.push(`| --- | --- | --- | --- | --- | --- | --- | ${runs.map(() => "---").join(" | ")} |`);
  for (const r of rows) {
    const c = r.probe ? summaryCells(r.probe.raw, r.sidecars) : { video: r.item.live ? "live, not probed" : "file missing", audio: "", subtitles: "" };
    const container = r.item.live ? "live HLS" : (r.probe?.container ?? "?");
    L.push(
      `| [${r.item.id}](playback-fixtures.md#${r.item.id.toLowerCase()}) | ${cell(r.item.title)} | ${container} | ${c.video} | ${c.audio} | ${c.subtitles} | ${LANE[r.item.mode]} | ${runs.map((run) => laneCell(r.item, run)).join(" | ")} |`,
    );
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
    `${fileRows.length} files, ${(fileRows.reduce((n, r) => n + (r.file ? fs.statSync(r.file).size : 0), 0) / 1e9).toFixed(1)} GB, none of it in git. Origin is recorded per file in [\`test/playback/provenance.json\`](../test/playback/provenance.json), from the generator's own tables and the files' embedded tags:`,
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
