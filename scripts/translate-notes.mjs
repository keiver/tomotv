#!/usr/bin/env node
/**
 * Release notes in the other store languages, translated by a local model.
 *
 * Usage:
 *   npm run notes                    translate what is missing, then print every block
 *   npm run notes -- --write         and write the blocks into the metadata document
 *   npm run notes -- --show          print them and translate nothing
 *   npm run notes -- --redo          draft the notes again over the ones already there
 *   npm run notes -- --redo promo    the same for the promotional text, after editing the English
 *   npm run notes -- --redo all      both
 *   npm run notes -- --locale de     one locale
 *   npm run notes -- --file x.txt    translate a bullet list from a file instead
 *   npm run notes -- --model X       another ollama model
 *
 * The English comes from the canonical paste blocks, so the loop for a release is
 * write the English notes there, run this, then `npm run meta:upload`.
 *
 * A block the document already holds is never rewritten. Translating once and
 * keeping the result is the point: a second sample of the same model is a
 * different text, not a better one, and the first was read by someone.
 *
 * The model drafts; this script decides. Every output is checked against the
 * glossary and the store limit; a failing draft goes back to the model with what
 * was wrong, twice, and is then reported rather than written as if it were good.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { DOC, LIMITS, PLATFORM_LABELS, STORE_LOCALES, measure, readMetadata, whatsNewVersions, writePromotionalText, writeWhatsNew } from "./appstore/metadata.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOSSARY = JSON.parse(fs.readFileSync(path.join(ROOT, "applestore", "l10n-glossary.json"), "utf8"));
const HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
/** A value, never the next flag: `--redo --write` leaves --redo without one. */
const opt = (n) => {
  const i = args.indexOf(n);
  const v = i >= 0 ? args[i + 1] : null;
  return v && !v.startsWith("-") ? v : null;
};
const MODEL = opt("--model") ?? "qwen3.6:35b";
const WRITE = flag("--write");
const SHOW = flag("--show");
// --redo names what to draft over, because the two fields move for different
// reasons: the notes are new every release, the promotional text only when its
// English is rewritten.
const REDO = flag("--redo") ? (opt("--redo") ?? "notes") : null;
const REDO_NOTES = REDO === "notes" || REDO === "all";
const REDO_PROMO = REDO === "promo" || REDO === "all";
const fail = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};
if (REDO && !REDO_NOTES && !REDO_PROMO) fail(`--redo takes notes, promo or all. Got "${REDO}".`);

const NAMES = { de: "German", fr: "French", es: "Spanish" };

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
const locales = opt("--locale") ? [opt("--locale")] : Object.keys(GLOSSARY.terms);
for (const l of locales) if (!GLOSSARY.terms[l]) fail(`No "${l}" in the glossary. Have: ${Object.keys(GLOSSARY.terms).join(", ")}`);

const FIELD_LABELS = {
  name: "App Name",
  subtitle: "Subtitle",
  promotionalText: "Promotional Text",
  keywords: "Keywords",
  "whatsNew.IOS": "What's New, iOS",
  "whatsNew.TV_OS": "What's New, tvOS",
  description: "Description",
};

/** Everything the document holds for this version, without calling the model. */
function show() {
  const doc = readMetadata(ROOT, VERSION);
  const wanted = opt("--locale") ? [STORE_LOCALES[opt("--locale")] ?? opt("--locale")] : Object.keys(doc);
  for (const locale of wanted) {
    const copy = doc[locale];
    if (!copy) fail(`No "${locale}" section in ${DOC}. Have: ${Object.keys(doc).join(", ")}`);
    console.log(`\n${"=".repeat(64)}\n${locale}  (version ${VERSION})\n${"=".repeat(64)}`);
    for (const [key, label] of Object.entries(FIELD_LABELS)) {
      const text = copy[key];
      const limit = LIMITS[key.split(".")[0]];
      const unit = key === "keywords" ? " bytes" : "";
      console.log(`\n${label} ${text ? `(${measure(key.split(".")[0], text)} / ${limit}${unit})` : "(missing)"}\n`);
      console.log(text ?? "  --");
    }
  }
}

/**
 * One English text going to one language. A block the document already has is
 * left alone: it has been read by someone, and a fresh sample of the same model
 * is not an improvement on copy that was accepted. --redo overrides that.
 */
function jobs() {
  const file = opt("--file") ?? args.find((a, i) => !a.startsWith("-") && !["--locale", "--model", "--file", "--redo"].includes(args[i - 1]));
  if (file) {
    return locales.map((locale) => ({ locale, field: "whatsNew", platform: null, write: false, english: fs.readFileSync(file, "utf8").trim() }));
  }
  const doc = readMetadata(ROOT, VERSION);
  const english = doc["en-US"];
  const previous = priorRelease();
  const out = [];
  for (const platform of ["IOS", "TV_OS"]) {
    const key = `whatsNew.${platform}`;
    const text = english[key];
    if (!text) fail(`No English What's New for ${VERSION} ${PLATFORM_LABELS[platform]} in ${DOC}`);
    for (const locale of locales) {
      const current = doc[STORE_LOCALES[locale]]?.[key];
      if (!REDO_NOTES && current) continue;
      const sibling = platform === "IOS" ? "TV_OS" : "IOS";
      out.push({
        locale,
        field: "whatsNew",
        platform,
        write: true,
        english: text,
        current,
        sibling: { locale, key: `whatsNew.${sibling}`, english: english[`whatsNew.${sibling}`], doc },
        example: examplePair(previous, locale, key),
      });
    }
  }
  for (const locale of locales) {
    const current = doc[STORE_LOCALES[locale]]?.promotionalText;
    if (!REDO_PROMO && current) continue;
    out.push({ locale, field: "promotionalText", platform: null, write: true, english: english.promotionalText, current });
  }
  return out;
}

/** The newest version whose notes are not the ones being written. */
function priorRelease() {
  const version = whatsNewVersions(ROOT).find((v) => v !== VERSION);
  return version ? readMetadata(ROOT, version) : null;
}

/**
 * The last release's notes in English and in this language. The model matches a
 * pair it can see; without one it reaches for a synonym and the vocabulary walks
 * between releases.
 */
function examplePair(previous, locale, key) {
  const source = previous?.["en-US"]?.[key];
  const target = previous?.[STORE_LOCALES[locale]]?.[key];
  return source && target ? { source, target } : null;
}

/**
 * The same release's other platform, if it has been translated. Those two texts
 * differ by one noun in English and have to differ by one noun in German too, so
 * it is the closest reference either of them will ever get.
 */
function siblingPair(sibling, done) {
  if (!sibling) return null;
  const target = done.get(`${sibling.locale}|${sibling.key}`) ?? sibling.doc[STORE_LOCALES[sibling.locale]]?.[sibling.key];
  return sibling.english && target ? { source: sibling.english, target } : null;
}

function prompt({ locale, field, english, example, current }) {
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
${anchor(locale, current, example)}
English:
${english}`;
}

/**
 * What the draft is measured against. A redo revises the wording in use rather
 * than sampling a new one, because the text being replaced was read and accepted
 * and a second sample of the same model is a different text, not a better one.
 * A first translation gets the last release instead, so the vocabulary does not
 * walk between versions.
 */
function anchor(locale, current, example) {
  if (current) {
    return `
This is the ${NAMES[locale]} in use. Keep every word of it that the English below
still says, and change only what the English changed. If the English says nothing
new, repeat it exactly. The pronoun rule above governs pronouns, not verbs: leave
the subject and the verb form as this text has them.

${current}
`;
  }
  if (example) {
    return `
The last release, translated the way this one should be. Reuse its wording for
anything these notes say again:

English:
${example.source}

${NAMES[locale]}:
${example.target}
`;
  }
  return "";
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
        // Greedy. Translating to a fixed glossary against wording already in use
        // has one right answer, and sampling is what walks away from it.
        options: { temperature: 0, num_predict: 1200 },
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

if (SHOW) {
  show();
  process.exit(0);
}

const queue = jobs();
if (!queue.length) {
  // Nothing to draft means the listing is complete, so print it. A one-line
  // "already translated" answers a question nobody asked.
  show();
  console.log(`\nEvery ${VERSION} block above is already translated. --redo, --redo promo or --redo all to draft over them.`);
  process.exit(0);
}

const accepted = [];
/** What this run has already settled, so the second platform can match the first. */
const done = new Map();
let rejected = 0;
for (const job of queue) {
  const where = job.field === "promotionalText" ? " promotional text" : job.platform ? ` ${PLATFORM_LABELS[job.platform]}` : "";
  job.example = siblingPair(job.sibling, done) ?? job.example;
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
    if (job.platform) done.set(`${job.locale}|whatsNew.${job.platform}`, out);
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
