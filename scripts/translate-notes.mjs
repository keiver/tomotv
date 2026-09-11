#!/usr/bin/env node
/**
 * Release notes in the other store languages, translated by a local model.
 *
 * Usage:
 *   npm run notes                    translate this version's What's New, both platforms
 *   npm run notes -- --write         and write the blocks into the metadata document
 *   npm run notes -- --promo         redo the promotional text too, after editing the English
 *   npm run notes -- --locale de     one locale
 *   npm run notes -- --file x.txt    translate a bullet list from a file instead
 *   npm run notes -- --model X       another ollama model
 *
 * The English comes from the canonical paste blocks, so the loop for a release is
 * write the English notes there, run this, then `npm run meta:upload`.
 *
 * The model drafts; this script decides. Every output is checked against the
 * glossary and the store limit; a failing draft goes back to the model with what
 * was wrong, twice, and is then reported rather than written as if it were good.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DOC, LIMITS, PLATFORM_LABELS, STORE_LOCALES, measure, readMetadata, writePromotionalText, writeWhatsNew } from "./appstore/metadata.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOSSARY = JSON.parse(fs.readFileSync(path.join(ROOT, "applestore", "l10n-glossary.json"), "utf8"));
const HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const MODEL = opt("--model") ?? "qwen3.6:35b";
const WRITE = flag("--write");
const PROMO = flag("--promo");
const fail = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};

const NAMES = { de: "German", fr: "French", es: "Spanish" };

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
const locales = opt("--locale") ? [opt("--locale")] : Object.keys(GLOSSARY.terms);
for (const l of locales) if (!GLOSSARY.terms[l]) fail(`No "${l}" in the glossary. Have: ${Object.keys(GLOSSARY.terms).join(", ")}`);

/** Every job is one English text going to one language, keyed by where it belongs. */
function jobs() {
  const file = opt("--file") ?? args.find((a, i) => !a.startsWith("-") && !["--locale", "--model", "--file"].includes(args[i - 1]));
  if (file) {
    return locales.map((locale) => ({ locale, field: "whatsNew", platform: null, write: false, english: fs.readFileSync(file, "utf8").trim() }));
  }
  const doc = readMetadata(ROOT, VERSION);
  const english = doc["en-US"];
  const out = [];
  for (const platform of ["IOS", "TV_OS"]) {
    const text = english[`whatsNew.${platform}`];
    if (!text) fail(`No English What's New for ${VERSION} ${PLATFORM_LABELS[platform]} in ${DOC}`);
    for (const locale of locales) out.push({ locale, field: "whatsNew", platform, write: true, english: text });
  }
  // The promotional text does not change per release, and the blocks it already
  // has have been read by someone. Redone only when asked, or when a language
  // has none at all.
  for (const locale of locales) {
    const have = doc[STORE_LOCALES[locale]]?.promotionalText;
    if (PROMO || !have) out.push({ locale, field: "promotionalText", platform: null, write: true, english: english.promotionalText });
  }
  return out;
}

function prompt({ locale, field, english }) {
  const terms = Object.entries(GLOSSARY.terms[locale])
    .map(([en, t]) => `  ${en} = ${t}`)
    .join("\n");
  // Naming the pronouns, not just the register: "address the reader as du" on
  // its own gets Sie-register German back.
  const { use, avoid } = GLOSSARY.pronouns[locale];
  const shape =
    field === "promotionalText"
      ? `Translate App Store promotional text into ${NAMES[locale]}.

Rules:
- Output ONLY the translation. No preamble, no notes, no code fences.
- One paragraph of short sentences, as many as the English has.
- At most ${LIMITS.promotionalText} characters. Shorten a sentence rather than drop one.`
      : `Translate App Store release notes into ${NAMES[locale]}.

Rules:
- Output ONLY the translated bullets. No preamble, no notes, no code fences.
- One bullet out for every bullet in, same order, each starting with "- ".`;
  return `${shape}
- Address the reader as ${GLOSSARY.register[locale]}: write ${use.join(", ")}.
- Never write ${avoid.join(", ")}. An English "your" is ${use[1] ?? use[0]}, never ${avoid[2] ?? avoid[0]}.
- Never use an em dash.
- Leave these exactly as written: ${GLOSSARY.keep.join(", ")}.
- Use these terms:
${terms}
- Plain and factual. Do not add claims, do not embellish, do not explain.

English:
${english}`;
}

/**
 * A second pass carries the draft and what was wrong with it. Asking again cold
 * returns the same register: qwen3.6 writes Sie-German from a du instruction
 * however plainly the pronouns are listed, and only corrects when shown its own
 * sentence.
 */
async function ask(job, draft, faults) {
  const messages = [{ role: "user", content: prompt(job) }];
  if (draft) {
    messages.push({ role: "assistant", content: draft });
    const shape = job.field === "whatsNew" ? "the bullets" : "the paragraph";
    messages.push({ role: "user", content: `That draft is wrong: ${faults.join("; ")}. Rewrite it, fixing only that. Output only ${shape}.` });
  }
  // The archive runs this and carries on when it fails, so a refused connection
  // has to read as one line, not a node stack.
  let res;
  try {
    res = await fetch(`${HOST}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        stream: false,
        think: false,
        options: { temperature: 0.2, num_predict: 1200 },
        messages,
      }),
    });
  } catch (e) {
    fail(`No ollama at ${HOST} (${e.cause?.code ?? e.message}). Start it, or set OLLAMA_HOST.`);
  }
  if (!res.ok) fail(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).message.content.trim();
}

/**
 * Register slips read as a different product voice, so they are a hard failure.
 * The glossary's avoid list is both the prompt rule and the check, so the two
 * cannot drift. German's capitalised Ihr costs a rare false positive on a
 * sentence-initial "their", which prints for a reader rather than shipping.
 */
function wrongRegister(locale) {
  const avoid = GLOSSARY.pronouns[locale]?.avoid ?? [];
  const group = (words) => `\\b(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\b`;
  const cased = avoid.filter((w) => w[0] !== w[0].toLowerCase());
  const plain = avoid.filter((w) => w[0] === w[0].toLowerCase());
  return [cased.length ? new RegExp(group(cased)) : null, plain.length ? new RegExp(group(plain), "i") : null].filter(Boolean);
}

/** What the model is not trusted to get right. */
function check(job, out) {
  const lines = out.split("\n").filter((l) => l.trim());
  const bullets = job.english.split("\n").filter((l) => l.trim());
  const bad = [];
  for (const re of wrongRegister(job.locale)) {
    const hit = out.match(re);
    if (hit) bad.push(`wrong register: "${hit[1] ?? hit[0]}" for a ${GLOSSARY.register[job.locale]} text`);
  }
  if (job.field === "whatsNew") {
    if (lines.length !== bullets.length) bad.push(`${lines.length} bullets out, ${bullets.length} in`);
    if (!lines.every((l) => l.startsWith("- "))) bad.push("a line is not a `- ` bullet");
  } else if (lines.length !== 1) {
    bad.push(`${lines.length} lines out, the promotional text is one paragraph`);
  }
  if (out.includes("—")) bad.push("contains an em dash");
  const size = measure(job.field, out);
  if (size > LIMITS[job.field]) bad.push(`${size} characters, over the ${LIMITS[job.field]} limit`);
  if (/```|^(here|voici|aquí|hier)\b/im.test(out)) bad.push("contains commentary or a code fence");
  for (const term of GLOSSARY.keep) {
    if (job.english.includes(term) && !out.includes(term)) bad.push(`dropped or translated "${term}"`);
  }
  return bad;
}

/**
 * Glossary terms the draft did not reproduce. A warning, not a failure: a verb
 * form of the term is fine, an invented noun is not, and only a reader can tell.
 */
function termMisses(job, out) {
  const esc = (w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  /** Plural-tolerant: "listes de lecture" has to satisfy "liste de lecture". */
  const loose = (t) =>
    new RegExp(
      t
        .split(/\s+/)
        .map((w) => `${esc(w)}s?`)
        .join("\\s+"),
      "i",
    );
  return Object.entries(GLOSSARY.terms[job.locale])
    .filter(([en]) => new RegExp(`\\b${esc(en)}s?\\b`, "i").test(job.english))
    .filter(([, target]) => !loose(target).test(out))
    .map(([en, target]) => `${en} -> ${target}`);
}

const accepted = [];
let rejected = 0;
for (const job of jobs()) {
  const where = job.field === "promotionalText" ? " promotional text" : job.platform ? ` ${PLATFORM_LABELS[job.platform]}` : "";
  let out = await ask(job);
  let bad = check(job, out);
  for (let pass = 0; bad.length && pass < 2; pass++) {
    const draft = out;
    out = await ask(job, draft, bad);
    bad = check(job, out);
  }
  console.log(`\n### ${NAMES[job.locale]}${where} (${measure(job.field, out)} / ${LIMITS[job.field]})\n`);
  console.log("```text");
  console.log(out);
  console.log("```");
  if (bad.length) {
    rejected++;
    console.error(`  ! rejected after a retry: ${bad.join("; ")}`);
    process.exitCode = 1;
  } else if (job.write) {
    accepted.push({ ...job, out });
  }
  const misses = termMisses(job, out);
  if (misses.length) console.error(`  ? glossary terms not reproduced: ${misses.join(", ")}`);
}
console.error(`\n  ? a native reader still has to pass over this before it ships`);

if (WRITE) {
  if (rejected) fail(`${rejected} draft(s) rejected; nothing written to ${DOC}`);
  if (!accepted.length) fail("Nothing to write. --write needs the document's own English notes, not --file.");
  const file = path.join(ROOT, DOC);
  let lines = fs.readFileSync(file, "utf8").split("\n");
  for (const { locale, field, platform, out } of [...accepted].sort((a, b) => (a.platform === b.platform ? 0 : a.platform === "TV_OS" ? -1 : 1))) {
    lines = field === "promotionalText" ? writePromotionalText(lines, STORE_LOCALES[locale], out) : writeWhatsNew(lines, STORE_LOCALES[locale], VERSION, platform, out);
  }
  fs.writeFileSync(file, lines.join("\n"));
  console.error(`  ✓ ${accepted.length} block(s) written into ${DOC}`);
}
