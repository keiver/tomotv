#!/usr/bin/env node
/**
 * Sends the store listing's text to App Store Connect, one localization per
 * language, so a new language is not left with screenshots and four empty
 * fields under them.
 *
 * Usage:
 *   npm run meta:upload                     every locale, both platforms
 *   npm run meta:upload -- --dry-run        print the plan, write nothing
 *   npm run meta:upload -- --locale de-DE,fr-FR   one language or a few
 *   npm run meta:upload -- --platform IOS   one platform
 *
 * The copy comes from the paste blocks in memories/CLAUDE-apple-store-metadata.md,
 * which that file declares canonical. What's New is taken for the version in
 * app.json and a missing one stops the run, so a release never ships the
 * previous release's notes.
 *
 * Name and subtitle live on the app info, description, keywords, promotional
 * text and What's New on the version. Only a version in PREPARE_FOR_SUBMISSION
 * is touched.
 *
 * Apple opens every version with the promotional text empty. It is hand-written
 * and carries across releases unchanged, so it is re-sent from the document each
 * run rather than retyped into the new draft.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ascEnv, client } from "./appstore/asc.mjs";
import { DOC, INFO_FIELDS, VERSION_FIELDS, measure, overLimit, readMetadata } from "./appstore/metadata.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_ID = "dev.keiver.tomotv";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n) => {
  const i = args.indexOf(n);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const DRY = flag("--dry-run");

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

/** The value the field should end up with, or null when there is nothing to say. */
function wanted(copy, field, platform) {
  return field === "whatsNew" ? (copy[`whatsNew.${platform}`] ?? null) : (copy[field] ?? null);
}

async function main() {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
  const meta = readMetadata(ROOT, version);
  const locales = opt("--locale") ? opt("--locale").split(",") : Object.keys(meta);
  const platforms = opt("--platform") ? [opt("--platform")] : ["IOS", "TV_OS"];

  // Everything is measured before anything is written: a listing half over the
  // limit is worse than one that never started.
  const problems = [];
  for (const locale of locales) {
    const copy = meta[locale];
    if (!copy) fail(`No "${locale}" section in ${DOC}. Have: ${Object.keys(meta).join(", ")}`);
    for (const field of [...INFO_FIELDS, ...VERSION_FIELDS]) {
      for (const platform of field === "whatsNew" ? platforms : [null]) {
        const text = wanted(copy, field, platform);
        if (!text) {
          problems.push(`${locale}: no ${field}${platform ? ` for ${platform}` : ""} (version ${version})`);
          continue;
        }
        const over = overLimit(field, text);
        if (over) problems.push(`${locale} ${field}: ${over}`);
      }
    }
  }
  if (problems.length) fail(`${DOC}\n  ${problems.join("\n  ")}`);

  const api = client(ascEnv(ROOT));
  const apps = await api.get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data[0];
  if (!app) fail(`No app with bundle id ${BUNDLE_ID} on this account`);
  console.log(`App Store Connect: ${BUNDLE_ID}, version ${version}${DRY ? " (dry run)" : ""}`);

  const versions = {};
  for (const platform of platforms) {
    const res = await api.get(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=${platform}&filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1`);
    const found = res.data[0];
    if (!found) fail(`No editable ${platform} version. Open the draft first: npm run shots:upload -- --create-version`);
    if (found.attributes.versionString !== version) {
      fail(`${platform} draft is ${found.attributes.versionString}, app.json says ${version}`);
    }
    versions[platform] = found;
  }

  // Two app infos exist while a change is pending: the live one and the editable
  // one. The name and subtitle only land on the editable one.
  const infos = await api.get(`/v1/apps/${app.id}/appInfos`);
  const info = infos.data.find((i) => i.attributes.appStoreState !== "READY_FOR_SALE");
  if (!info) fail("No editable app info. Its name and subtitle cannot be changed while the listing is live with no draft.");

  for (const platform of platforms) {
    const versionId = versions[platform].id;
    const existing = await api.get(`/v1/appStoreVersions/${versionId}/appStoreVersionLocalizations`);
    // A new language inherits the URLs the English listing already carries,
    // rather than a value from a document that can disagree with the listing.
    const english = existing.data.find((l) => l.attributes.locale === "en-US")?.attributes ?? {};

    for (const locale of locales) {
      const copy = meta[locale];
      let current = existing.data.find((l) => l.attributes.locale === locale);
      if (!current) {
        if (DRY) {
          console.log(`  ${platform} ${locale}: would create the localization`);
        } else {
          const created = await api.post("/v1/appStoreVersionLocalizations", {
            data: {
              type: "appStoreVersionLocalizations",
              attributes: { locale, marketingUrl: english.marketingUrl, supportUrl: english.supportUrl },
              relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: versionId } } },
            },
          });
          current = created.data;
        }
      }

      const attributes = {};
      for (const field of VERSION_FIELDS) {
        const text = wanted(copy, field, platform);
        if (text !== (current?.attributes?.[field] ?? null)) attributes[field] = text;
      }
      if (!current?.attributes?.supportUrl && english.supportUrl) attributes.supportUrl = english.supportUrl;
      if (!current?.attributes?.marketingUrl && english.marketingUrl) attributes.marketingUrl = english.marketingUrl;

      const summary = Object.keys(attributes).length
        ? Object.entries(attributes)
            .map(([f, t]) => `${f} ${typeof t === "string" ? measure(f, t) : t}`)
            .join(", ")
        : "unchanged";
      console.log(`  ${platform} ${locale.padEnd(6)} ${summary}`);
      if (DRY || !Object.keys(attributes).length || !current) continue;
      await api.patch(`/v1/appStoreVersionLocalizations/${current.id}`, {
        data: { type: "appStoreVersionLocalizations", id: current.id, attributes },
      });
    }
  }

  const infoLocalizations = await api.get(`/v1/appInfos/${info.id}/appInfoLocalizations`);
  const englishInfo = infoLocalizations.data.find((l) => l.attributes.locale === "en-US")?.attributes ?? {};
  for (const locale of locales) {
    const copy = meta[locale];
    let current = infoLocalizations.data.find((l) => l.attributes.locale === locale);
    if (!current) {
      if (DRY) {
        console.log(`  info ${locale}: would create the localization`);
      } else {
        const created = await api.post("/v1/appInfoLocalizations", {
          data: {
            type: "appInfoLocalizations",
            attributes: { locale, privacyPolicyUrl: englishInfo.privacyPolicyUrl },
            relationships: { appInfo: { data: { type: "appInfos", id: info.id } } },
          },
        });
        current = created.data;
      }
    }
    const attributes = {};
    for (const field of INFO_FIELDS) {
      if (copy[field] !== (current?.attributes?.[field] ?? null)) attributes[field] = copy[field];
    }
    if (!current?.attributes?.privacyPolicyUrl && englishInfo.privacyPolicyUrl) {
      attributes.privacyPolicyUrl = englishInfo.privacyPolicyUrl;
    }
    const summary = Object.keys(attributes).length ? Object.keys(attributes).join(", ") : "unchanged";
    console.log(`  info ${locale.padEnd(6)} ${summary}`);
    if (DRY || !Object.keys(attributes).length || !current) continue;
    await api.patch(`/v1/appInfoLocalizations/${current.id}`, {
      data: { type: "appInfoLocalizations", id: current.id, attributes },
    });
  }

  console.log(DRY ? "\n--dry-run: nothing written" : "\nListing text uploaded. Read it in App Store Connect before submitting.");
}

main().catch((e) => fail(e.message));
