#!/usr/bin/env node
/**
 * Uploads the generated screenshots to App Store Connect, one set per store
 * language, so the German listing carries the German captures and nobody drags
 * ninety PNGs into a browser again.
 *
 * Usage:
 *   npm run shots:upload                        every locale, both platforms
 *   npm run shots:upload -- --locale de         one language
 *   npm run shots:upload -- --platform TV_OS    one platform
 *   npm run shots:upload -- --dry-run           say what would happen, upload nothing
 *   npm run shots:upload -- --create-version    create the draft version first, if there is none
 *   npm run shots:upload -- --allow-english-captures   upload a locale whose captures are the English ones
 *
 * It reads applestore/generated/<locale>/<device>/, which `npm run shots` writes,
 * and refuses to run when a locale's directory is missing rather than leaving
 * that language on last release's screenshots.
 *
 * Only a version in an editable state is touched. A version already waiting for
 * review is left alone: replacing its screenshots is a rejection, not an edit.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ascEnv, client, md5 } from "./appstore/asc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "applestore", "shots.config.json");
const BUNDLE_ID = "dev.keiver.tomotv";

/**
 * Which ASC slot each generated size belongs in. The sizes come from
 * shots.config.json's device profiles, and Apple's enum is the one thing here
 * that cannot be derived: correct it in this table and nowhere else.
 * memories/CLAUDE-apple-store-metadata.md records why 1320x2868 is the 6.9" slot.
 */
const DISPLAY_TYPES = {
  iphone: { platform: "IOS", type: "APP_IPHONE_67", size: "1320x2868" },
  ipad: { platform: "IOS", type: "APP_IPAD_PRO_3GEN_129", size: "2064x2752" },
  tv: { platform: "TV_OS", type: "APP_APPLE_TV", size: "3840x2160" },
};

/** ASC locale codes for the languages the listing is written in. */
const STORE_LOCALES = { en: "en-US", de: "de-DE", fr: "fr-FR", es: "es-ES" };

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
};
const DRY = flag("--dry-run");
const CREATE_VERSION = flag("--create-version");

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function shotsFor(locale, deviceKey) {
  const dir = path.join(ROOT, "applestore", "generated", locale, deviceKey);
  if (!fs.existsSync(dir)) return null;
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * The raw device captures behind a locale's composites. English sits flat, the
 * way it always has; every other language has its own directory.
 */
function capturesFor(locale, deviceKey) {
  const dir = locale === "en" ? path.join(ROOT, "applestore", "captures", deviceKey) : path.join(ROOT, "applestore", "captures", locale, deviceKey);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".png"))
    .sort()
    .map((f) => path.join(dir, f));
}

/** Reserve, upload every part Apple asks for, then commit with the checksum. */
async function uploadScreenshot(api, setId, file) {
  const bytes = fs.readFileSync(file);
  const reservation = await api.post("/v1/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileSize: bytes.length, fileName: path.basename(file) },
      relationships: { appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } } },
    },
  });
  const id = reservation.data.id;
  for (const operation of reservation.data.attributes.uploadOperations ?? []) {
    await api.put(operation, bytes.subarray(operation.offset, operation.offset + operation.length));
  }
  await api.patch(`/v1/appScreenshots/${id}`, {
    data: { type: "appScreenshots", id, attributes: { uploaded: true, sourceFileChecksum: md5(file) } },
  });
  return id;
}

async function setFor(api, localizationId, displayType) {
  const existing = await api.get(`/v1/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`);
  const found = existing.data.find((s) => s.attributes.screenshotDisplayType === displayType);
  if (found) return found.id;
  const created = await api.post("/v1/appScreenshotSets", {
    data: {
      type: "appScreenshotSets",
      attributes: { screenshotDisplayType: displayType },
      relationships: { appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } } },
    },
  });
  return created.data.id;
}

async function main() {
  if (!fs.existsSync(CONFIG)) fail(`Missing ${CONFIG}`);
  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const locales = opt("--locale") ? [opt("--locale")] : Object.keys(config.locales ?? {});
  const platforms = opt("--platform") ? [opt("--platform")] : ["IOS", "TV_OS"];

  // Every locale is checked before anything is uploaded: a half-uploaded listing
  // is worse than one that never started.
  const plan = [];
  const identical = [];
  for (const locale of locales) {
    if (!STORE_LOCALES[locale]) fail(`No App Store locale for "${locale}". Add it to STORE_LOCALES.`);
    for (const [deviceKey, slot] of Object.entries(DISPLAY_TYPES)) {
      if (!platforms.includes(slot.platform)) continue;
      const files = shotsFor(locale, deviceKey);
      if (!files || files.length === 0) {
        fail(`No screenshots at applestore/generated/${locale}/${deviceKey}. Run npm run shots first.`);
      }
      // The composites always differ, because the caption is translated. What
      // decides whether a listing is honest is the capture UNDER the caption:
      // no capture of its own, or one identical to English, means the app was
      // not in that language when the pass ran, and the German listing would
      // carry a German caption over an English screen.
      if (locale !== "en") {
        const own = capturesFor(locale, deviceKey);
        const english = capturesFor("en", deviceKey);
        if (own.length === 0) identical.push(`${locale}/${deviceKey} (no capture of its own)`);
        else if (own.length === english.length && own.every((f, i) => md5(f) === md5(english[i]))) {
          identical.push(`${locale}/${deviceKey} (identical to English)`);
        }
      }
      plan.push({ locale, deviceKey, slot, files });
    }
  }

  if (identical.length && !flag("--allow-english-captures")) {
    fail(
      `These sets are byte-identical to the English ones, so the app was not in that language when they were taken:\n` +
        `  ${identical.join("\n  ")}\n\n` +
        `Recapture with npm run shots -- --capture (it sets tomotv://dev-locale per pass), or pass --allow-english-captures if an English screen is genuinely what that listing should show.`,
    );
  }

  console.log(`App Store Connect: ${BUNDLE_ID}`);
  for (const p of plan) console.log(`  ${STORE_LOCALES[p.locale].padEnd(6)} ${p.slot.type.padEnd(24)} ${p.files.length} shots`);
  if (DRY) {
    console.log("\n--dry-run: nothing uploaded");
    return;
  }

  const api = client(ascEnv(ROOT));
  const apps = await api.get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data[0];
  if (!app) fail(`No app with bundle id ${BUNDLE_ID} on this account`);

  // The editable version per platform. EDITABLE covers every state Apple lets a
  // screenshot change land in, which is not the same list on both platforms.
  const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
  const versions = {};
  for (const platform of platforms) {
    const res = await api.get(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=${platform}&filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1`);
    let version = res.data[0];
    if (!version) {
      // Deliberately not automatic: creating a version is a change to the
      // listing, and an upload that quietly opens one is how a half-filled
      // version reaches App Store Connect without anybody deciding to.
      if (!CREATE_VERSION) {
        fail(`No editable ${platform} version. Re-run with --create-version to open ${appVersion} as a draft, or create it in App Store Connect first.`);
      }
      const created = await api.post("/v1/appStoreVersions", {
        data: {
          type: "appStoreVersions",
          attributes: { platform, versionString: appVersion },
          relationships: { app: { data: { type: "apps", id: app.id } } },
        },
      });
      version = created.data;
      console.log(`  ${platform}: created draft ${appVersion}`);
    }
    versions[platform] = version;
    console.log(`  ${platform}: version ${version.attributes.versionString}`);
  }

  for (const { locale, deviceKey, slot, files } of plan) {
    const version = versions[slot.platform];
    const localizations = await api.get(`/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations`);
    const existing = localizations.data.find((l) => l.attributes.locale === STORE_LOCALES[locale]);
    const localizationId = existing
      ? existing.id
      : (
          await api.post("/v1/appStoreVersionLocalizations", {
            data: {
              type: "appStoreVersionLocalizations",
              attributes: { locale: STORE_LOCALES[locale] },
              relationships: { appStoreVersion: { data: { type: "appStoreVersions", id: version.id } } },
            },
          })
        ).data.id;

    const setId = await setFor(api, localizationId, slot.type);
    // Replaced, not appended: a set that keeps last release's shots alongside
    // this one's is the failure nobody notices until the listing is live.
    const current = await api.get(`/v1/appScreenshotSets/${setId}/appScreenshots`);
    for (const shot of current.data) await api.delete(`/v1/appScreenshots/${shot.id}`);

    for (const file of files) await uploadScreenshot(api, setId, file);
    console.log(`  ✓ ${STORE_LOCALES[locale]} ${slot.type}: ${files.length} uploaded`);
  }

  console.log("\nScreenshots uploaded. App Store Connect processes them asynchronously; check the version before submitting.");
}

main().catch((e) => fail(e.message));
