#!/usr/bin/env node
/**
 * Sets a build's TestFlight What to Test from the English What's New, then submits it for beta review and adds it to the
 * external TestFlight group, per platform, when its review slot is free. --no-submit sets What to Test only.
 *
 * Usage:
 *   node scripts/appstore-testflight.mjs <buildNumber> [--platform MAC_OS] [--no-submit]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readMetadata } from "./appstore/metadata.mjs";
import { selectedPlatforms } from "./appstore/platforms.mjs";
import { setWhatToTest, submitForExternalTesting } from "./appstore/testflight.mjs";

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
  if (!/^\d+$/.test(buildNumber ?? "")) fail("Usage: node scripts/appstore-testflight.mjs <buildNumber> [--platform MAC_OS] [--no-submit]");
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
  const submit = !process.argv.includes("--no-submit");
  const api = client(ascEnv(ROOT));
  const app = (await api.get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) fail(`No app with bundle id ${BUNDLE_ID} on this account`);
  let group = null;
  if (submit) {
    const groups = await api.get(`/v1/apps/${app.id}/betaGroups?limit=200`);
    group = groups.data.find((g) => g.attributes.name === EXTERNAL_GROUP && !g.attributes.isInternalGroup);
    if (!group) fail(`No external TestFlight group named ${EXTERNAL_GROUP}`);
  }
  const english = readMetadata(ROOT, version)["en-US"] ?? {};

  const platformArg = process.argv.indexOf("--platform");
  for (const platform of selectedPlatforms(platformArg > 0 ? process.argv[platformArg + 1] : null)) {
    console.log(`  ${(await setWhatToTest(api, app.id, platform, version, buildNumber, english[`whatsNew.${platform}`] ?? null)).reason}`);
    if (submit) console.log(`  ${(await submitForExternalTesting(api, app.id, platform, version, buildNumber, group.id)).reason}`);
  }
}

main().catch((e) => fail(e.message));
