#!/usr/bin/env node
/**
 * The parallel-download gate: times one connection against N ranged connections
 * for the same span of a file. Parts ship only where this shows a gain on the
 * capped link being tested; a LAN run shows parity by design.
 *
 *   node scripts/download-parts-probe.mjs <url> [--mb 64] [--parts 4] [--header "Name: value"]...
 */

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--"));
if (!url) {
  console.error('usage: download-parts-probe.mjs <url> [--mb 64] [--parts 4] [--header "Name: value"]...');
  process.exit(1);
}
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};
const mb = Number(opt("--mb", "64"));
const partCount = Number(opt("--parts", "4"));
const headers = {};
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--header") {
    const [name, ...rest] = args[i + 1].split(":");
    headers[name.trim()] = rest.join(":").trim();
  }
}

const span = mb * 1024 * 1024;

async function drain(response) {
  let bytes = 0;
  for await (const chunk of response.body) bytes += chunk.length;
  return bytes;
}

async function timedRange(start, end) {
  const response = await fetch(url, { headers: { ...headers, Range: `bytes=${start}-${end}` } });
  if (response.status !== 206) throw new Error(`expected 206, got ${response.status}`);
  return drain(response);
}

function rate(bytes, ms) {
  return `${((bytes * 8) / 1000 / ms).toFixed(1)} Mb/s`;
}

const head = await fetch(url, { headers: { ...headers, Range: "bytes=0-0" } });
head.body?.cancel?.();
const total = Number(head.headers.get("content-range")?.split("/")[1]);
if (head.status !== 206 || !Number.isFinite(total)) {
  console.error(`no ranged answers from this server (status ${head.status}); parts cannot apply`);
  process.exit(2);
}
const window = Math.min(span, total);
console.log(`file ${(total / 1e6).toFixed(0)} MB, probing ${(window / 1e6).toFixed(0)} MB, ${partCount} parts`);

let t = Date.now();
const singleBytes = await timedRange(0, window - 1);
const singleMs = Date.now() - t;
console.log(`single: ${rate(singleBytes, singleMs)} (${(singleMs / 1000).toFixed(1)}s)`);

const per = Math.floor(window / partCount);
t = Date.now();
const counts = await Promise.all(Array.from({ length: partCount }, (_, i) => timedRange(i * per, i === partCount - 1 ? window - 1 : (i + 1) * per - 1)));
const partedMs = Date.now() - t;
const partedBytes = counts.reduce((sum, n) => sum + n, 0);
console.log(`parted: ${rate(partedBytes, partedMs)} (${(partedMs / 1000).toFixed(1)}s)`);
console.log(`gain: ${(singleMs / partedMs).toFixed(2)}x`);
