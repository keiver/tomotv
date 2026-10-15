import assert from "node:assert/strict";
import { test } from "node:test";
import { attachBuild, editableVersion, isFirstVersion, placementGroup, platformVersions, selectedPlatforms, uploadedDevices } from "../appstore/platforms.mjs";

const version = (versionString, appStoreState, id = versionString) => ({ id, attributes: { versionString, appStoreState } });
test("platform selection includes Mac and rejects misspellings", () => {
  assert.deepEqual(selectedPlatforms(), ["IOS", "MAC_OS", "TV_OS"]);
  assert.deepEqual(selectedPlatforms("MAC_OS,IOS,MAC_OS"), ["MAC_OS", "IOS"]);
  assert.throws(() => selectedPlatforms("macOS"), /Unknown platform/);
});
test("first Mac version omits What's New until an earlier version was released", () => {
  const current = version("2.2.11", "PREPARE_FOR_SUBMISSION");
  assert.equal(isFirstVersion([current], "2.2.11"), true);
  assert.equal(isFirstVersion([current, version("2.2.10", "DEVELOPER_REJECTED")], "2.2.11"), true);
  assert.equal(isFirstVersion([current, version("2.2.10", "READY_FOR_SALE")], "2.2.11"), false);
  assert.equal(isFirstVersion([current, version("2.2.10", "REMOVED_FROM_SALE")], "2.2.11"), false);
});
test("wrong editable version stops instead of changing another release", () => {
  assert.throws(() => editableVersion([version("2.2.10", "PREPARE_FOR_SUBMISSION")], "MAC_OS", "2.2.11"), /draft is 2.2.10/);
});
test("release history follows pagination", async () => {
  const calls = [];
  const api = {
    get: async (url) => {
      calls.push(url);
      return calls.length === 1 ? { data: [1], links: { next: "page2" } } : { data: [2] };
    },
  };
  assert.deepEqual(await platformVersions(api, "app", "MAC_OS"), [1, 2]);
  assert.equal(calls[1], "page2");
});
test("build selection waits for the exact version, number and Mac platform", async () => {
  let polls = 0;
  const patches = [];
  const api = {
    get: async (url) => {
      if (url.includes("appStoreVersions?")) return { data: [version("2.2.11", "PREPARE_FOR_SUBMISSION", "draft")] };
      if (url.endsWith("/build")) return { data: { id: "build" } };
      assert.match(url, /filter\[version\]=500/);
      assert.match(url, /filter\[preReleaseVersion.version\]=2.2.11/);
      assert.match(url, /filter\[preReleaseVersion.platform\]=MAC_OS/);
      return { data: ++polls === 1 ? [] : [{ id: "build", attributes: { processingState: "VALID" } }] };
    },
    patch: async (...args) => patches.push(args),
  };
  await attachBuild(api, "app", "MAC_OS", "2.2.11", "500", { delay: async () => {} });
  assert.equal(polls, 2);
  assert.deepEqual(patches, [["/v1/appStoreVersions/draft/relationships/build", { data: { type: "builds", id: "build" } }]]);
});

const spec = (specId, w, h) => ({ specId, dimensions: { minWidth: w, maxWidth: w, minHeight: h, maxHeight: h } });
const refData = {
  data: [
    {
      attributes: {
        placementProfileGroups: [
          { placementProfileGroupId: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", platform: "IPHONE_APP_STORE", displayClassId: "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY" },
          { placementProfileGroupId: "IMESSAGE_IPHONE_DUO_PROFILE", platform: "IMESSAGE_APP_STORE", displayClassId: "IPHONE_DUO" },
          { placementProfileGroupId: "IPHONE_DUO_PROFILE", platform: "IPHONE_APP_STORE", displayClassId: "IPHONE_DUO" },
          { placementProfileGroupId: "MAC_PROFILE", platform: "MAC_APP_STORE", displayClassId: "DEFAULT" },
        ],
        placementTypes: [
          {
            placementTypeId: "APP_SCREENSHOT",
            specMappings: [
              { placementGroupId: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", specs: ["phone"] },
              { placementGroupId: "IPHONE_DUO_PROFILE", specs: ["outer", "inner"] },
            ],
          },
        ],
        imageSpecs: [spec("phone", 1320, 2868), spec("outer", 1398, 2034), spec("inner", 2007, 2853)],
        features: [
          {
            featureId: "APP_STORE_VERSIONS",
            placementPolicies: [{ placementType: "APP_SCREENSHOT", groupLimits: [{ groupIds: ["IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", "IPHONE_DUO_PROFILE"], maxCount: 10 }] }],
          },
        ],
      },
    },
  ],
};
test("each device's placement group, sizes and limit come from the reference data", () => {
  assert.deepEqual(placementGroup(refData, "iphone"), { group: "IPHONE_DYNAMIC_ISLAND_LARGE_PROFILE", sizes: ["1320x2868"], maxCount: 10 });
  assert.deepEqual(placementGroup(refData, "duo-outer"), { group: "IPHONE_DUO_PROFILE", sizes: ["1398x2034", "2007x2853"], maxCount: 10 });
  assert.equal(placementGroup(refData, "duo-inner").group, "IPHONE_DUO_PROFILE");
});
test("a device with no placement group or no screenshot slot stops the upload", () => {
  assert.throws(() => placementGroup(refData, "tv"), /no TV_APP_STORE placement group/);
  assert.throws(() => placementGroup(refData, "mac"), /MAC_PROFILE takes no screenshots/);
});
test("devices marked upload false and devices of other platforms are not uploaded", () => {
  const config = { devices: { iphone: {}, mac: {}, "duo-outer": { upload: false }, "duo-inner": { upload: true } } };
  assert.deepEqual(uploadedDevices(config), ["iphone", "mac", "duo-inner"]);
  assert.deepEqual(uploadedDevices(config, ["MAC_OS"]), ["mac"]);
});
