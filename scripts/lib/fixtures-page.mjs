/**
 * docs/playback-fixtures.html: the fixture inventory as one self-contained page with a codec index
 * and filters. Complete without script; the script only filters.
 */

const esc = (v) =>
  String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const GROUPS = { video: "Video codecs", audio: "Audio codecs", subtitle: "Subtitle codecs", container: "Containers" };

/** The index keys one fixture carries, e.g. "audio:truehd". */
export function fixtureTags(f) {
  const tags = new Set();
  for (const row of f.streams ?? []) if (GROUPS[row[1]]) tags.add(`${row[1]}:${row[2].split(/[ ,(]/)[0]}`);
  for (const sc of f.sidecars ?? []) tags.add(`subtitle:${sc.codec ?? "unreadable"}`);
  const container = f.facts?.find(([k]) => k === "Container")?.[1].split(" (")[0];
  tags.add(`container:${f.live ? "live HLS" : (container ?? "missing")}`);
  return [...tags];
}

function indexHtml(fixtures) {
  const counts = new Map();
  for (const f of fixtures) for (const t of fixtureTags(f)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return Object.entries(GROUPS)
    .map(([g, label]) => {
      const chips = [...counts]
        .filter(([t]) => t.startsWith(`${g}:`))
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([t, n]) => `<button type="button" class="chip" aria-pressed="false" data-key="${esc(t)}">${esc(t.slice(g.length + 1))}<b>${n}</b></button>`);
      return `<div><h2>${label} · ${chips.length}</h2><div class="chips">${chips.join("")}</div></div>`;
    })
    .join("\n");
}

function fixtureHtml(f) {
  const head = `<h3>${esc(f.id)}<span>${esc(f.title.replace(new RegExp(`^${f.id}\\s*`), ""))}</span></h3>`;
  let body;
  if (f.live)
    body = `<p>Live TV channel, ${f.live.url ? `origin <code>${esc(f.live.url)}</code> in` : "not found in"} <code>test/playback/live/real.m3u</code>. Not a file: its streams are whatever the origin sends at run time, so nothing here is probed.</p><p>${esc(f.expectLine)}</p>`;
  else if (!f.facts) body = `<p>No file with this title under the fixture roots, so nothing is probed.</p>`;
  else {
    const facts = f.facts.map(([k, v, code]) => `<tr><td>${esc(k)}</td><td>${code ? `<code>${esc(v)}</code>` : esc(v)}</td></tr>`).join("");
    const streams = f.streams.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`);
    for (const sc of f.sidecars)
      streams.push(
        `<tr><td>sidecar</td><td>subtitle</td><td>${esc(sc.codec ?? "unreadable")}</td><td><code>${esc(sc.name)}</code>, ${sc.bytes.toLocaleString("en-US")} bytes, SHA-256 <code>${esc(sc.sha256)}</code></td><td></td><td></td><td></td></tr>`,
      );
    body =
      `<div class="scroll"><table class="facts"><tbody>${facts}</tbody></table></div>` +
      `<div class="scroll"><table class="streams"><thead><tr><th>#</th><th>Type</th><th>Codec</th><th>Detail</th><th>Language</th><th>Title</th><th>Flags</th></tr></thead><tbody>${streams.join("")}</tbody></table></div>`;
  }
  return `<section class="fx" id="${esc(f.id.toLowerCase())}" data-tags="${esc(fixtureTags(f).join("|"))}">${head}${body}</section>`;
}

export function fixturesPage({ lede, fixtures }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tomo Playback Fixtures</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Atkinson+Hyperlegible:wght@400;700&family=JetBrains+Mono:wght@400;600&display=swap">
<style>
:root {
  --bg: #f4f5f7; --panel: #ffffff; --fg: #1b1e24; --muted: #5d6573; --rule: #dde1e7;
  --accent: #8a6400; --chip: #fff3cc; --chip-on: #ffc312; --chip-on-fg: #2b1f05;
  --display: "Archivo", "Helvetica Neue", Arial, sans-serif;
  --body: "Atkinson Hyperlegible", "Segoe UI", system-ui, sans-serif;
  --mono: "JetBrains Mono", ui-monospace, Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #111317; --panel: #191c22; --fg: #e5e8ed; --muted: #9aa3b2; --rule: #2a2f38; --accent: #ffc312; --chip: #2a2414; color-scheme: dark; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 15px/1.55 var(--body); }
[hidden] { display: none !important; }
.wrap { max-width: 1180px; margin: 0 auto; padding-inline: 16px; padding-block: 28px 64px; display: grid; gap: 22px; }
header h1 { font: 800 clamp(28px, 4vw, 40px)/1.1 var(--display); margin: 0; letter-spacing: -0.01em; }
header p { margin: 8px 0 0; max-width: 72ch; color: var(--muted); }
.bar { position: sticky; top: 0; z-index: 2; background: var(--bg); padding-block: 10px; border-bottom: 1px solid var(--rule); display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
.bar input { flex: 1 1 260px; min-width: 0; font: 15px var(--body); padding: 9px 12px; border: 1px solid var(--rule); border-radius: 6px; background: var(--panel); color: var(--fg); }
.bar input:focus-visible, .chip:focus-visible, button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.count { font: 600 13px var(--mono); color: var(--muted); font-variant-numeric: tabular-nums; }
.bar button { font: 600 13px var(--body); border: 1px solid var(--rule); background: var(--panel); color: var(--fg); padding: 8px 12px; border-radius: 6px; cursor: pointer; }
.index { display: grid; gap: 12px; }
.index h2 { font: 700 12px var(--display); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); margin: 0 0 6px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chip { font: 13px var(--mono); border: 1px solid transparent; background: var(--chip); color: var(--fg); padding: 3px 9px; border-radius: 4px; cursor: pointer; }
.chip b { font-weight: 600; color: var(--muted); margin-left: 4px; }
.chip[aria-pressed="true"] { background: var(--chip-on); color: var(--chip-on-fg); }
.chip[aria-pressed="true"] b { color: var(--chip-on-fg); }
main { display: grid; gap: 14px; }
section.fx { background: var(--panel); border: 1px solid var(--rule); border-radius: 8px; padding: 16px; display: grid; gap: 12px; min-width: 0; scroll-margin-top: 70px; }
section.fx h3 { margin: 0; font: 800 22px var(--display); color: var(--accent); display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
section.fx h3 span { font: 600 15px var(--mono); color: var(--fg); }
section.fx p { margin: 0; max-width: 90ch; overflow-wrap: anywhere; }
.scroll { overflow-x: auto; min-width: 0; }
table { border-collapse: collapse; width: 100%; font-size: 13.5px; }
th, td { text-align: left; vertical-align: top; padding: 5px 10px 5px 0; border-bottom: 1px solid var(--rule); }
th { font: 700 11px var(--display); text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
table.facts td:first-child { width: 150px; color: var(--muted); white-space: nowrap; }
table.facts td:last-child { overflow-wrap: anywhere; }
table.streams { min-width: 860px; }
table.streams td:nth-child(3) { min-width: 220px; }
table.streams td:nth-child(4) { min-width: 300px; }
code { font: 12.5px var(--mono); overflow-wrap: anywhere; }
footer { color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<div class="wrap">
<header><h1>Tomo Playback Fixtures</h1><p>${esc(lede)}</p></header>
<div class="bar">
<input id="q" type="search" placeholder="Filter: hevc, truehd, pgs, interlaced, smpte2084, T85" aria-label="Filter fixtures">
<span class="count" id="count">${fixtures.length} of ${fixtures.length}</span>
<button id="clear" type="button">Clear</button>
</div>
<div class="index" id="index">
${indexHtml(fixtures)}
</div>
<main>
${fixtures.map(fixtureHtml).join("\n")}
</main>
<footer>Generated by <code>npm run report:playback -- --fixtures</code>, and after every <code>npm run test:playback</code>. Every value is what ffprobe reported for the file.</footer>
</div>
<script>
(() => {
  const sections = [...document.querySelectorAll("section.fx")];
  for (const s of sections) s.dataset.text = s.textContent.toLowerCase();
  const q = document.getElementById("q");
  const count = document.getElementById("count");
  const chips = [...document.querySelectorAll(".chip")];
  const apply = () => {
    const terms = q.value.toLowerCase().split(/\\s+/).filter(Boolean);
    const keys = chips.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.key);
    let shown = 0;
    for (const s of sections) {
      const tags = s.dataset.tags.split("|");
      s.hidden = !(keys.every((k) => tags.includes(k)) && terms.every((t) => s.dataset.text.includes(t)));
      if (!s.hidden) shown++;
    }
    count.textContent = shown + " of " + sections.length;
  };
  for (const c of chips) c.onclick = () => { c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true")); apply(); };
  q.addEventListener("input", apply);
  document.getElementById("clear").onclick = () => { q.value = ""; chips.forEach((c) => c.setAttribute("aria-pressed", "false")); apply(); };
})();
</script>
</body>
</html>
`;
}
