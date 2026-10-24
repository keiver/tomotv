#!/usr/bin/env node
/**
 * Selects a build for the editable App Store version of app.json's version, every platform not held by a review.
 *
 * Usage:
 *   node scripts/appstore-attach-build.mjs <buildNumber> [--platform MAC_OS]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { attachBuild, listingPlatforms } from "./appstore/platforms.mjs";

import { ascEnv, client } from "./appstore/asc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_ID = "dev.keiver.tomotv";

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const buildNumber = process.argv[2];
  if (!/^\d+$/.test(buildNumber ?? "")) fail("Usage: node scripts/appstore-attach-build.mjs <buildNumber>");
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
  const api = client(ascEnv(ROOT));
  const app = (await api.get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) fail(`No app with bundle id ${BUNDLE_ID} on this account`);

  const platformArg = process.argv.indexOf("--platform");
  for (const { platform } of await listingPlatforms(api, app.id, version, platformArg > 0 ? process.argv[platformArg + 1] : null)) {
    await attachBuild(api, app.id, platform, version, buildNumber);
    console.log(`  ${platform} ${version}: build ${buildNumber} selected`);
  }
}

main().catch((e) => fail(e.message));
