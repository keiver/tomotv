#!/usr/bin/env node
/**
 * Accessibility Nutrition Labels from scripts/appstore/accessibility.json, which keeps one
 * entry per app version. The store gets, per device, the entry of the version live on that
 * device's platform; a live version without an entry is skipped.
 *
 * Usage:
 *   npm run meta:a11y -- --check       check the file offline, then stop
 *   npm run meta:a11y -- --prepare     give app.json's version an entry (a copy of the newest when missing), offline
 *   npm run meta:a11y -- --dry-run     print the plan, write nothing
 *   npm run meta:a11y                  create or update the drafts
 *   npm run meta:a11y -- --publish     also publish every draft the store does not show yet
 *
 * `npm run archive -- <build> --upload` runs --prepare before building and --publish after
 * the listing text. Apple publishes only for devices with a live version.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ascEnv, client } from "./appstore/asc.mjs";
import { createBody, liveAnswers, liveVersion, planDeclarations, publishBody, readAccessibility, summary, updateBody, withVersion } from "./appstore/accessibility.mjs";
import { PLATFORMS, platformVersions } from "./appstore/platforms.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FILE = path.join(ROOT, "scripts/appstore/accessibility.json");
const BUNDLE_ID = "dev.keiver.tomotv";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const DRY = flag("--dry-run");
const CHECK = flag("--check");
const PREPARE = flag("--prepare");
const PUBLISH = flag("--publish");

function fail(msg) {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
}

function printEntry(version, entry) {
  for (const [family, answers] of Object.entries(entry)) console.log(`  ${version} ${family}: ${summary(answers)}`);
}

async function main() {
  let record;
  try {
    record = readAccessibility(FILE);
  } catch (error) {
    fail(error.message);
  }
  if (CHECK) {
    for (const [version, entry] of Object.entries(record)) printEntry(version, entry);
    return console.log("\n✓ accessibility.json is valid");
  }
  if (PREPARE) {
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8")).expo.version;
    const prepared = withVersion(record, version);
    if (prepared.copiedFrom) {
      fs.writeFileSync(FILE, `${JSON.stringify(prepared.record, null, 2)}\n`);
      console.log(`  ${version} had no accessibility entry: copied ${prepared.copiedFrom}'s. Re-check it for this release and commit the file.`);
    }
    printEntry(version, prepared.record[version]);
    return;
  }

  const api = client(ascEnv(ROOT));
  const app = (await api.get(`/v1/apps?filter[bundleId]=${BUNDLE_ID}`)).data[0];
  if (!app) fail(`No app with bundle id ${BUNDLE_ID} on this account`);
  const live = {};
  for (const platform of PLATFORMS) live[platform] = liveVersion(await platformVersions(api, app.id, platform));
  const devices = liveAnswers(record, live);
  // REPLACED ones pile up with every release; only a draft or the published one can matter.
  const existing = (await api.get(`/v1/apps/${app.id}/accessibilityDeclarations?filter[state]=DRAFT,PUBLISHED&limit=200`)).data ?? [];
  const steps = planDeclarations(Object.fromEntries(devices.filter((device) => device.answers).map((device) => [device.family, device.answers])), existing);

  console.log(`\nApp Store Connect: ${BUNDLE_ID}${DRY ? " (dry run)" : ""}`);
  for (const device of devices) {
    if (!device.answers) {
      console.log(`  ${device.family}: ${device.version ? `${device.version} live, no entry` : "no live version"}, skipped`);
      continue;
    }
    const step = steps.find((s) => s.family === device.family);
    const what = step.write === "create" ? "create a draft" : step.write === "update" ? `update the draft (${step.changed.join(", ")})` : "draft matches";
    const shown = step.publish ? (PUBLISH ? ", then publish" : ", not published yet") : ", already on the store";
    console.log(`  ${device.family}: ${device.version} live: ${summary(device.answers)}; ${what}${shown}`);
  }
  if (DRY) return console.log("\n--dry-run: nothing written");

  for (const step of steps) {
    if (step.write === "create") step.id = (await api.post("/v1/accessibilityDeclarations", createBody(app.id, step.family, devices.find((d) => d.family === step.family).answers))).data.id;
    else if (step.write === "update") await api.patch(`/v1/accessibilityDeclarations/${step.id}`, updateBody(step.id, step.family, devices.find((d) => d.family === step.family).answers));
  }
  if (!PUBLISH) return console.log("\nDrafts saved. Publish with npm run meta:a11y -- --publish.");

  let refused = 0;
  for (const step of steps.filter((s) => s.publish)) {
    try {
      await api.patch(`/v1/accessibilityDeclarations/${step.id}`, publishBody(step.id));
      console.log(`  ${step.family}: published`);
    } catch (error) {
      refused++;
      console.error(`  ${step.family}: not published: ${error.message}`);
    }
  }
  if (refused) process.exit(1);
  console.log("\nThe store can take up to 24 hours to show published labels.");
}

main().catch((error) => fail(error.message));
