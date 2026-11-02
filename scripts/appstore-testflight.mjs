#!/usr/bin/env node
/**
 * Submits a build for beta review and adds it to the external TestFlight group, per platform, when its review slot is free.
 *
 * Usage:
 *   node scripts/appstore-testflight.mjs <buildNumber> [--platform MAC_OS]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { selectedPlatforms } from "./appstore/platforms.mjs";
import { submitForExternalTesting } from "./appstore/testflight.mjs";

import { ascEnv, client } from "./appstore/asc.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUNDLE_ID = "dev.keiver.tomotv";
const EXTERNAL_GROUP = "Tomo Warrior Testers";

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

async function main() {
  const buildNumber = process.argv[2];
  if (!/^\d+$/.test(buildNumber ?? "")) fail("Usage: node scripts/appstore-testflight.mjs <buildNumber> [--platform MAC_OS]");
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
  const api = client(ascEnv(ROOT));
  const app = (await api.get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) fail(`No app with bundle id ${BUNDLE_ID} on this account`);
  const groups = await api.get(`/v1/apps/${app.id}/betaGroups?limit=200`);
  const group = groups.data.find((g) => g.attributes.name === EXTERNAL_GROUP && !g.attributes.isInternalGroup);
  if (!group) fail(`No external TestFlight group named ${EXTERNAL_GROUP}`);

  const platformArg = process.argv.indexOf("--platform");
  for (const platform of selectedPlatforms(platformArg > 0 ? process.argv[platformArg + 1] : null)) {
    const { reason } = await submitForExternalTesting(api, app.id, platform, version, buildNumber, group.id);
    console.log(`  ${reason}`);
  }
}

main().catch((e) => fail(e.message));
