import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  compareVersions,
  createBody,
  liveAnswers,
  liveVersion,
  offeredFeatures,
  planDeclarations,
  problems,
  publishBody,
  readAccessibility,
  updateBody,
  withVersion,
} from "../appstore/accessibility.mjs";

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../appstore/accessibility.json");
const answers = (family, value = false) => Object.fromEntries(offeredFeatures(family).map((feature) => [feature, value]));
const entry = (value = false) => Object.fromEntries(["IPHONE", "IPAD", "MAC", "APPLE_TV"].map((family) => [family, answers(family, value)]));
const declaration = (id, family, state, values) => ({ id, attributes: { deviceFamily: family, state, ...values } });
const storeVersion = (versionString, appVersionState) => ({ attributes: { versionString, appVersionState } });

test("the checked-in accessibility.json is valid and has an entry for every device Tomo ships", () => {
  const record = readAccessibility(FILE);
  for (const version of Object.keys(record)) assert.deepEqual(Object.keys(record[version]).sort(), ["APPLE_TV", "IPAD", "IPHONE", "MAC"]);
});

test("a valid record has no problems", () => {
  assert.deepEqual(problems({ "2.2.15": entry(), "2.2.16": entry(true) }), []);
});

test("a bad version key, an unknown device, an unknown feature, a non-boolean and a missing feature are each reported", () => {
  assert.match(problems({ latest: entry() })[0], /latest: not an app version/);
  assert.match(problems({ "2.2.15": { ANDROID: {} } })[0], /ANDROID: not a device family Tomo ships/);
  assert.match(problems({ "2.2.15": { IPHONE: { ...answers("IPHONE"), supportsBraille: true } } })[0], /supportsBraille: not an Apple accessibility feature/);
  assert.match(problems({ "2.2.15": { IPHONE: { ...answers("IPHONE"), supportsCaptions: "yes" } } })[0], /supportsCaptions: must be true or false/);
  const { supportsCaptions, ...rest } = answers("IPHONE");
  assert.equal(supportsCaptions, false);
  assert.match(problems({ "2.2.15": { IPHONE: rest } })[0], /2\.2\.15\.IPHONE\.supportsCaptions: missing/);
  assert.match(problems({})[0], /no version is recorded/);
});

test("Voice Control on Apple TV and Larger Text on Mac are refused", () => {
  assert.match(problems({ "2.2.15": { APPLE_TV: { ...answers("APPLE_TV"), supportsVoiceControl: true } } })[0], /Apple does not offer this feature on APPLE_TV/);
  assert.match(problems({ "2.2.15": { MAC: { ...answers("MAC"), supportsLargerText: false } } })[0], /Apple does not offer this feature on MAC/);
});

test("versions compare by number, not as text", () => {
  assert.ok(compareVersions("2.2.10", "2.2.9") > 0);
  assert.ok(compareVersions("2.3", "2.2.15") > 0);
  assert.equal(compareVersions("2.2.15", "2.2.15"), 0);
});

test("a new version starts as a copy of the newest entry, and an existing one is left as it is", () => {
  const record = { "2.2.9": entry(false), "2.2.10": entry(true) };
  const { record: next, copiedFrom } = withVersion(record, "2.2.11");
  assert.equal(copiedFrom, "2.2.10");
  assert.deepEqual(next["2.2.11"], record["2.2.10"]);
  next["2.2.11"].IPHONE.supportsCaptions = false;
  assert.equal(record["2.2.10"].IPHONE.supportsCaptions, true, "the copy is its own object");
  assert.deepEqual(withVersion(record, "2.2.10"), { record, copiedFrom: null });
});

test("the live version is the one ready for distribution", () => {
  assert.equal(liveVersion([storeVersion("2.2.15", "WAITING_FOR_REVIEW"), storeVersion("2.2.14", "READY_FOR_DISTRIBUTION"), storeVersion("2.2.13", "REPLACED_WITH_NEW_VERSION")]), "2.2.14");
  assert.equal(liveVersion([storeVersion("1.0", "PREPARE_FOR_SUBMISSION")]), null);
});

test("each device gets the entry of its own platform's live version, and nothing when that version has none", () => {
  const record = { "2.2.14": entry(true) };
  const devices = liveAnswers(record, { IOS: "2.2.14", MAC_OS: "2.2.11", TV_OS: "2.2.14" });
  assert.deepEqual(
    devices.map((device) => [device.family, device.version, !!device.answers]),
    [
      ["IPHONE", "2.2.14", true],
      ["IPAD", "2.2.14", true],
      ["MAC", "2.2.11", false],
      ["APPLE_TV", "2.2.14", true],
    ],
  );
  assert.equal(
    liveAnswers(record, {}).every((device) => device.answers === null),
    true,
  );
});

test("a device with no declaration gets a draft created, then published", () => {
  const [step] = planDeclarations({ IPHONE: answers("IPHONE", true) }, []);
  assert.deepEqual([step.write, step.publish], ["create", true]);
});

test("a draft that differs is updated with only the changed features named", () => {
  const [step] = planDeclarations({ IPAD: { ...answers("IPAD"), supportsCaptions: true } }, [declaration("d1", "IPAD", "DRAFT", answers("IPAD"))]);
  assert.deepEqual([step.write, step.id, step.changed, step.publish], ["update", "d1", ["supportsCaptions"], true]);
});

test("a published declaration that matches needs nothing", () => {
  const [step] = planDeclarations({ MAC: answers("MAC", true) }, [declaration("p1", "MAC", "PUBLISHED", answers("MAC", true))]);
  assert.deepEqual([step.write, step.publish], ["none", false]);
});

test("a published declaration that differs gets a new draft, and another device's matching one is left alone", () => {
  const steps = planDeclarations({ MAC: answers("MAC", true), IPHONE: answers("IPHONE") }, [
    declaration("p1", "MAC", "PUBLISHED", answers("MAC")),
    declaration("p2", "IPHONE", "PUBLISHED", answers("IPHONE")),
  ]);
  assert.deepEqual(
    steps.map((step) => [step.family, step.write, step.publish]),
    [
      ["MAC", "create", true],
      ["IPHONE", "none", false],
    ],
  );
});

test("a matching draft over an older published declaration is only published", () => {
  const [step] = planDeclarations({ IPHONE: answers("IPHONE", true) }, [declaration("p1", "IPHONE", "PUBLISHED", answers("IPHONE")), declaration("d1", "IPHONE", "DRAFT", answers("IPHONE", true))]);
  assert.deepEqual([step.write, step.id, step.publish], ["none", "d1", true]);
});

test("the bodies follow Apple's example payloads and leave out features a device does not offer", () => {
  const create = createBody("app-1", "APPLE_TV", answers("APPLE_TV", true));
  assert.equal(create.data.type, "accessibilityDeclarations");
  assert.equal(create.data.attributes.deviceFamily, "APPLE_TV");
  assert.equal("supportsVoiceControl" in create.data.attributes, false);
  assert.deepEqual(create.data.relationships, { app: { data: { type: "apps", id: "app-1" } } });
  assert.equal("supportsLargerText" in updateBody("d1", "MAC", answers("MAC")).data.attributes, false);
  assert.deepEqual(publishBody("d1"), { data: { type: "accessibilityDeclarations", id: "d1", attributes: { publish: true } } });
});
