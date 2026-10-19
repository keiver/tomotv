#!/usr/bin/env node
/**
 * Uploads the generated screenshots to App Store Connect, one set per store
 * language, so the German listing carries the German captures and nobody drags
 * ninety PNGs into a browser again.
 *
 * Usage:
 *   npm run shots:upload                        every locale, all three platforms
 *   npm run shots:upload -- --locale de         one language
 *   npm run shots:upload -- --platform TV_OS    one platform
 *   npm run shots:upload -- --dry-run           say what would happen, upload nothing
 *   npm run shots:upload -- --create-version    create the draft version first, if there is none
 *
 * It reads applestore/generated/<locale>/<device>/, which `npm run shots` writes,
 * and refuses to run when a locale's directory is missing rather than leaving
 * that language on last release's screenshots.
 *
 * Only a version in an editable state is touched. A version already waiting for
 * review is left alone: replacing its screenshots is a rejection, not an edit.
 *
 * Screenshots go through the App Asset Library. A device whose entry in shots.config.json
 * has "upload": false is rendered but never uploaded.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ascEnv, client } from "./appstore/asc.mjs";
import { SCREENSHOT_DEVICES, acceptsSize, listingPlatforms, placementGroup, selectedPlatforms, uploadedDevices } from "./appstore/platforms.mjs";
import { generatedShots, validateCaptures } from "./appstore/captures.mjs";
import { replaceScreenshots } from "./appstore/placements.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CONFIG = path.join(ROOT, "applestore", "shots.config.json");
const BUNDLE_ID = "dev.keiver.tomotv";

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

async function main() {
  if (!fs.existsSync(CONFIG)) fail(`Missing ${CONFIG}`);
  const config = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
  const locales = opt("--locale") ? [opt("--locale")] : Object.keys(config.locales ?? {});
  const platforms = selectedPlatforms(opt("--platform"));
  const devices = uploadedDevices(config, platforms);

  await validateCaptures(ROOT, config, devices, locales);

  // Every locale is checked before anything is uploaded: a half-uploaded listing
  // is worse than one that never started.
  const plan = [];
  for (const locale of locales) {
    if (!STORE_LOCALES[locale]) fail(`No App Store locale for "${locale}". Add it to STORE_LOCALES.`);
    for (const deviceKey of devices) {
      const files = await generatedShots(ROOT, config, locale, deviceKey);
      if (!files || files.length === 0) {
        fail(`No screenshots at applestore/generated/${locale}/${deviceKey}. Run npm run shots first.`);
      }
      plan.push({ locale, deviceKey, files });
    }
  }

  console.log(`App Store Connect: ${BUNDLE_ID}`);
  for (const p of plan) console.log(`  ${STORE_LOCALES[p.locale].padEnd(6)} ${p.deviceKey.padEnd(10)} ${p.files.length} shots`);
  if (DRY) {
    console.log("\n--dry-run: nothing uploaded");
    return;
  }

  const api = client(ascEnv(ROOT));
  const apps = await api.get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`);
  const app = apps.data[0];
  if (!app) fail(`No app with bundle id ${BUNDLE_ID} on this account`);

  // Devices sharing a placement group fill it together, in shot order.
  const refData = await api.get("/v1/appAssetLibraryRefData");
  const groups = new Map();
  for (const { locale, deviceKey, files } of plan) {
    const { group, sizes, maxCount } = placementGroup(refData, deviceKey);
    if (!acceptsSize(sizes, SCREENSHOT_DEVICES[deviceKey].size)) fail(`${deviceKey}: ${group} does not take ${SCREENSHOT_DEVICES[deviceKey].size} (it takes ${sizes.join(", ")})`);
    const key = `${locale}/${group}`;
    if (!groups.has(key)) groups.set(key, { locale, platform: SCREENSHOT_DEVICES[deviceKey].platform, group, maxCount, entries: [] });
    const shotIndex = (file) => config.shots.findIndex((shot) => `${shot.id}.png` === path.basename(file));
    groups.get(key).entries.push(...files.map((file) => ({ file, order: [shotIndex(file), devices.indexOf(deviceKey)] })));
  }
  for (const { locale, group, maxCount, entries } of groups.values()) {
    if (entries.length > maxCount) fail(`${locale} ${group}: ${entries.length} screenshots, App Store Connect takes ${maxCount}. Drop devices from shots in shots.config.json.`);
    entries.sort((a, b) => a.order[0] - b.order[0] || a.order[1] - b.order[1]);
  }
  const libraryId = (await api.get(`/v1/apps/${app.id}/assetLibrary`)).data.id;

  // The PREPARE_FOR_SUBMISSION version per platform, the only state that takes a
  // screenshot change; absent one, --create-version opens the draft.
  const appVersion = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
  const versions = {};
  for (const { platform, slot, version: found } of await listingPlatforms(api, app.id, appVersion, opt("--platform"))) {
    let version = found;
    if (slot === "free") {
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

  for (const { locale, platform, group, entries } of groups.values()) {
    const version = versions[platform];
    if (!version) continue;
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

    // Replaced, not appended: a group that keeps last release's shots alongside
    // this one's is the failure nobody notices until the listing is live.
    await replaceScreenshots(api, { libraryId, localizationId, group, files: entries.map((e) => e.file) });
    console.log(`  ✓ ${STORE_LOCALES[locale]} ${group}: ${entries.length} uploaded`);
  }

  console.log("\nScreenshots uploaded. App Store Connect processes them asynchronously; check the version before submitting.");
}

main().catch((e) => fail(e.message));
