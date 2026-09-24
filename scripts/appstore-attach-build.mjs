#!/usr/bin/env node
/**
 * Selects a build for the editable App Store version of app.json's version, both platforms.
 *
 * Usage:
 *   node scripts/appstore-attach-build.mjs <buildNumber>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

  for (const platform of ["IOS", "TV_OS"]) {
    const res = await api.get(`/v1/apps/${app.id}/appStoreVersions?filter[platform]=${platform}&filter[appStoreState]=PREPARE_FOR_SUBMISSION&limit=1`);
    const draft = res.data[0];
    if (!draft) fail(`No editable ${platform} version. Open the draft first: npm run shots:upload -- --create-version`);
    if (draft.attributes.versionString !== version) fail(`${platform} draft is ${draft.attributes.versionString}, app.json says ${version}`);

    const builds = await api.get(`/v1/builds?filter[app]=${app.id}&filter[version]=${buildNumber}&filter[preReleaseVersion.version]=${version}&filter[preReleaseVersion.platform]=${platform}&limit=1`);
    const build = builds.data[0];
    if (!build) fail(`${platform}: no build ${buildNumber} for ${version} on App Store Connect`);
    if (build.attributes.processingState !== "VALID") fail(`${platform}: build ${buildNumber} is ${build.attributes.processingState}, not VALID`);

    await api.patch(`/v1/appStoreVersions/${draft.id}/relationships/build`, { data: { type: "builds", id: build.id } });
    const selected = await api.get(`/v1/appStoreVersions/${draft.id}/build`);
    if (selected.data?.id !== build.id) fail(`${platform}: App Store Connect did not keep build ${buildNumber} on ${version}`);
    console.log(`  ${platform} ${version}: build ${buildNumber} selected`);
  }
}

main().catch((e) => fail(e.message));
