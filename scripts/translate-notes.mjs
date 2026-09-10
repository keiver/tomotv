#!/usr/bin/env node
/**
 * Release notes in the other store languages, translated by a local model.
 *
 * Usage:
 *   npm run notes -- notes.txt              translate a bullet list to every locale
 *   npm run notes -- notes.txt --locale de  one locale
 *   npm run notes -- notes.txt --model X    another ollama model
 *
 * The model drafts; this script decides. Every output is checked against the
 * glossary and the store limit, and a draft that fails is retried once and then
 * reported rather than printed as if it were good.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GLOSSARY = JSON.parse(fs.readFileSync(path.join(ROOT, "applestore", "l10n-glossary.json"), "utf8"));
const HOST = process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434";
/** App Store Connect caps "What's New" at 4000 characters. */
const LIMIT = 4000;

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 ? args[i + 1] : null;
};
const MODEL = opt("--model") ?? "qwen3.6:35b";
const fail = (m) => {
  console.error(`\n✗ ${m}\n`);
  process.exit(1);
};

const source = args.find((a, i) => !a.startsWith("-") && !["--locale", "--model"].some((f) => args[i - 1] === f));
if (!source) fail("Give a file holding the English bullet list.");
const english = fs.readFileSync(source, "utf8").trim();
const bullets = english.split("\n").filter((l) => l.trim());
if (!bullets.every((l) => l.startsWith("- "))) fail("Every line must be a `- ` bullet.");

const NAMES = { de: "German", fr: "French", es: "Spanish" };
const locales = opt("--locale") ? [opt("--locale")] : Object.keys(GLOSSARY.terms);

function prompt(locale) {
  const terms = Object.entries(GLOSSARY.terms[locale])
    .map(([en, t]) => `  ${en} = ${t}`)
    .join("\n");
  return `Translate App Store release notes into ${NAMES[locale]}.

Rules:
- Output ONLY the translated bullets. No preamble, no notes, no code fences.
- One bullet out for every bullet in, same order, each starting with "- ".
- Address the reader as ${GLOSSARY.register[locale]}.
- Never use an em dash.
- Leave these exactly as written: ${GLOSSARY.keep.join(", ")}.
- Use these terms:
${terms}
- Plain and factual. Do not add claims, do not embellish, do not explain.

English notes:
${english}`;
}

async function ask(locale) {
  const res = await fetch(`${HOST}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: MODEL,
      stream: false,
      think: false,
      options: { temperature: 0.2, num_predict: 1200 },
      messages: [{ role: "user", content: prompt(locale) }],
    }),
  });
  if (!res.ok) fail(`ollama ${res.status}: ${await res.text()}`);
  return (await res.json()).message.content.trim();
}

/** Register slips read as a different product voice, so they are a hard failure. */
const WRONG_REGISTER = {
  de: [/\b(euer|eure[mnrs]?|euch|ihr Server|Ihre[mnrs]?|Ihnen)\b/],
  fr: [/\b(tu|ton|ta|tes|toi)\b/i],
  es: [/\b(usted|ustedes|su servidor|vosotros)\b/i],
};

/** What the model is not trusted to get right. */
function check(locale, out) {
  const lines = out.split("\n").filter((l) => l.trim());
  const bad = [];
  for (const re of WRONG_REGISTER[locale] ?? []) {
    const hit = out.match(re);
    if (hit) bad.push(`wrong register: "${hit[0]}" for a ${GLOSSARY.register[locale]} text`);
  }
  if (lines.length !== bullets.length) bad.push(`${lines.length} bullets out, ${bullets.length} in`);
  if (!lines.every((l) => l.startsWith("- "))) bad.push("a line is not a `- ` bullet");
  if (out.includes("—")) bad.push("contains an em dash");
  if (out.length > LIMIT) bad.push(`${out.length} characters, over the ${LIMIT} limit`);
  if (/```|^(here|voici|aquí|hier)\b/im.test(out)) bad.push("contains commentary or a code fence");
  for (const term of GLOSSARY.keep) {
    const inEnglish = english.includes(term);
    if (inEnglish && !out.includes(term)) bad.push(`dropped or translated "${term}"`);
  }
  return bad;
}

/**
 * Glossary terms the draft did not reproduce. A warning, not a failure: a verb
 * form of the term is fine, an invented noun is not, and only a reader can tell.
 */
function termMisses(locale, out) {
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
  return Object.entries(GLOSSARY.terms[locale])
    .filter(([en]) => new RegExp(`\\b${esc(en)}s?\\b`, "i").test(english))
    .filter(([, target]) => !loose(target).test(out))
    .map(([en, target]) => `${en} -> ${target}`);
}

for (const locale of locales) {
  if (!GLOSSARY.terms[locale]) fail(`No "${locale}" in the glossary. Have: ${Object.keys(GLOSSARY.terms).join(", ")}`);
  let out = await ask(locale);
  let bad = check(locale, out);
  if (bad.length) {
    out = await ask(locale);
    bad = check(locale, out);
  }
  const misses = termMisses(locale, out);
  console.log(`\n### ${NAMES[locale]} (${out.length} / ${LIMIT})\n`);
  if (bad.length) {
    console.log("```text");
    console.log(out);
    console.log("```");
    console.error(`  ! rejected after a retry: ${bad.join("; ")}`);
    process.exitCode = 1;
  } else {
    console.log("```text");
    console.log(out);
    console.log("```");
  }
  if (misses.length) console.error(`  ? glossary terms not reproduced: ${misses.join(", ")}`);
  console.error(`  ? a native reader still has to pass over this before it ships`);
}
