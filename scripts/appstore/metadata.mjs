/**
 * The canonical store copy, read out of memories/CLAUDE-apple-store-metadata.md.
 *
 * That file's paste blocks are the source of record, so the uploader parses them
 * rather than keeping a second copy that can drift from the one a human edits.
 */
import fs from "node:fs";
import path from "node:path";

export const DOC = path.join("memories", "CLAUDE-apple-store-metadata.md");

/** ASC locale per language key, matching the screenshot pipeline's keys. */
export const STORE_LOCALES = { en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES" };

/** Apple's field limits. Keywords are counted in bytes, the rest in characters. */
export const LIMITS = { name: 30, subtitle: 30, promotionalText: 170, keywords: 100, description: 4000, whatsNew: 4000 };

/** Which ASC resource each field is written to. */
export const VERSION_FIELDS = ["description", "keywords", "promotionalText", "whatsNew"];
export const INFO_FIELDS = ["name", "subtitle"];

/** How the document names each platform in a What's New heading. */
export const PLATFORM_LABELS = { IOS: "iOS", TV_OS: "tvOS" };

const FIELDS = {
  "App Name": "name",
  Subtitle: "subtitle",
  "Promotional Text": "promotionalText",
  Keywords: "keywords",
  Description: "description",
};

/** Header line, then the ```text fence under it. The last parenthetical is the count. */
const HEADING = /^#{3,4}\s+(.*?)\s*\([^()]*\)\s*$/;

function blocks(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const head = lines[i].match(HEADING);
    if (!head) continue;
    let j = i + 1;
    while (j < lines.length && !lines[j].trim()) j++;
    if (lines[j] !== "```text") continue;
    const body = [];
    for (j++; j < lines.length && lines[j] !== "```"; j++) body.push(lines[j]);
    out.push({ label: head[1], text: body.join("\n").trim() });
  }
  return out;
}

/** "What's New (2.2.6), iOS" -> the version it belongs to and the platform. */
function whatsNew(label) {
  const m = label.match(/^What's New \(([^)]+)\),\s*(iOS|tvOS)$/);
  return m ? { version: m[1], platform: m[2] === "iOS" ? "IOS" : "TV_OS" } : null;
}

function collect(lines, version) {
  const copy = {};
  for (const b of blocks(lines)) {
    const field = FIELDS[b.label];
    if (field) {
      copy[field] = b.text;
      continue;
    }
    const wn = whatsNew(b.label);
    if (wn && wn.version === version) copy[`whatsNew.${wn.platform}`] = b.text;
  }
  return copy;
}

function region(lines, start) {
  const from = lines.findIndex((l) => l.startsWith(start));
  if (from < 0) throw new Error(`${DOC} has no "${start}" section`);
  const rest = lines.slice(from + 1);
  const to = rest.findIndex((l) => /^## /.test(l));
  return to < 0 ? rest : rest.slice(0, to);
}

/**
 * Every language's copy for one app version. A language section is keyed by the
 * first locale in its heading, so "### Spanish (es-ES, es-MX)" is es-ES.
 */
export function readMetadata(root, version) {
  const lines = fs.readFileSync(path.join(root, DOC), "utf8").split("\n");
  const english = region(lines, "## Paste blocks (App Store Connect)");
  const localized = region(lines, "## Localized paste blocks");

  const byLocale = { "en-US": collect(english, version) };
  let current = null;
  let buffer = [];
  const flush = () => {
    if (current) byLocale[current] = collect(buffer, version);
  };
  for (const line of localized) {
    const head = line.match(/^### .*?\(([a-z]{2}-[A-Z]{2})/);
    if (head) {
      flush();
      current = head[1];
      buffer = [];
      continue;
    }
    buffer.push(line);
  }
  flush();
  return byLocale;
}

/**
 * The versions that have English What's New blocks, newest first, which is the
 * order the document keeps them in.
 */
export function whatsNewVersions(root) {
  const lines = fs.readFileSync(path.join(root, DOC), "utf8").split("\n");
  const seen = [];
  for (const b of blocks(region(lines, "## Paste blocks (App Store Connect)"))) {
    const wn = whatsNew(b.label);
    if (wn && !seen.includes(wn.version)) seen.push(wn.version);
  }
  return seen;
}

/** Characters for every field but keywords, which Apple counts in bytes. */
export function measure(field, text) {
  return field === "keywords" ? Buffer.byteLength(text, "utf8") : [...text].length;
}

export function overLimit(field, text) {
  const size = measure(field, text);
  return size > LIMITS[field] ? `${size} over the ${LIMITS[field]} limit` : null;
}

/** The lines of one language's section, and where it starts in the document. */
function sectionOf(lines, locale) {
  const start = lines.findIndex((l) => new RegExp(`^### .*\\(${locale}`).test(l));
  if (start < 0) throw new Error(`No ${locale} section in ${DOC}`);
  const after = lines.slice(start + 1).findIndex((l) => /^## |^### /.test(l));
  return { start, section: lines.slice(start, after < 0 ? lines.length : start + 1 + after) };
}

/** Replace the block under `prefix`, or insert it where `fallback` says. */
function put(lines, locale, prefix, header, text, fallback) {
  const block = [header, "", "```text", ...text.split("\n"), "```", ""];
  const { start, section } = sectionOf(lines, locale);
  const existing = section.findIndex((l) => l.startsWith(prefix));
  if (existing >= 0) {
    const next = section.slice(existing + 1).findIndex((l) => /^#### /.test(l));
    const close = next < 0 ? section.length : existing + 1 + next;
    return [...lines.slice(0, start + existing), ...block, ...lines.slice(start + close)];
  }
  const at = start + fallback(section);
  return [...lines.slice(0, at), ...block, ...lines.slice(at)];
}

/**
 * Write tvOS before iOS: each insert goes above the notes already there, so iOS
 * last leaves the pair in the order the document keeps.
 */
export function writeWhatsNew(lines, locale, version, platform, text) {
  const label = PLATFORM_LABELS[platform];
  const prefix = `#### What's New (${version}), ${label} (`;
  const header = `${prefix}${measure("whatsNew", text)} / ${LIMITS.whatsNew} chars)`;
  return put(lines, locale, prefix, header, text, (section) => {
    const first = section.findIndex((l) => /^#### What's New \(/.test(l));
    return first < 0 ? section.length : first;
  });
}

/** Promotional text sits between the subtitle and the keywords. */
export function writePromotionalText(lines, locale, text) {
  const prefix = "#### Promotional Text (";
  const header = `${prefix}${measure("promotionalText", text)} / ${LIMITS.promotionalText} chars)`;
  return put(lines, locale, prefix, header, text, (section) => {
    const keywords = section.findIndex((l) => l.startsWith("#### Keywords ("));
    return keywords < 0 ? section.length : keywords;
  });
}
