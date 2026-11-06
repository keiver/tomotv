/**
 * Accessibility Nutrition Labels: accessibility.json keeps one entry per app version, each
 * the per-device answers for that version. The store gets the entry of the version that is
 * live on each platform. Pure: nothing here touches the network.
 */
import fs from "node:fs";

export const FEATURES = [
  "supportsVoiceover",
  "supportsVoiceControl",
  "supportsLargerText",
  "supportsDarkInterface",
  "supportsDifferentiateWithoutColorAlone",
  "supportsSufficientContrast",
  "supportsReducedMotion",
  "supportsCaptions",
  "supportsAudioDescriptions",
];

/** The features Apple does not offer on a device (App Store Connect API, "Configuring accessibility declarations"). */
export const NOT_OFFERED = {
  APPLE_TV: ["supportsVoiceControl"],
  MAC: ["supportsLargerText"],
};

/** The devices Tomo ships, and the store platform whose live version each device's label describes. */
export const PLATFORM_OF = { IPHONE: "IOS", IPAD: "IOS", MAC: "MAC_OS", APPLE_TV: "TV_OS" };

export const offeredFeatures = (family) => FEATURES.filter((feature) => !(NOT_OFFERED[family] ?? []).includes(feature));

const VERSION = /^\d+\.\d+(\.\d+)?$/;
const isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);

function entryProblems(version, entry) {
  if (!isObject(entry)) return [`${version}: must be an object keyed by device family`];
  const found = [];
  const families = Object.keys(entry);
  if (families.length === 0) found.push(`${version}: no device family is declared`);
  for (const family of families) {
    if (!(family in PLATFORM_OF)) {
      found.push(`${version}.${family}: not a device family Tomo ships (${Object.keys(PLATFORM_OF).join(", ")})`);
      continue;
    }
    const answers = entry[family];
    if (!isObject(answers)) {
      found.push(`${version}.${family}: must be an object of feature answers`);
      continue;
    }
    const offered = offeredFeatures(family);
    for (const key of Object.keys(answers)) {
      if (!FEATURES.includes(key)) found.push(`${version}.${family}.${key}: not an Apple accessibility feature`);
      else if (!offered.includes(key)) found.push(`${version}.${family}.${key}: Apple does not offer this feature on ${family}`);
      else if (typeof answers[key] !== "boolean") found.push(`${version}.${family}.${key}: must be true or false`);
    }
    for (const feature of offered) if (!(feature in answers)) found.push(`${version}.${family}.${feature}: missing`);
  }
  return found;
}

/** Every problem in the file, so one run lists them all. */
export function problems(record) {
  if (!isObject(record)) return ["the file must be an object keyed by app version"];
  const versions = Object.keys(record);
  if (versions.length === 0) return ["no version is recorded"];
  return versions.flatMap((version) => (VERSION.test(version) ? entryProblems(version, record[version]) : [`${version}: not an app version`]));
}

export function readAccessibility(file) {
  const record = JSON.parse(fs.readFileSync(file, "utf8"));
  const found = problems(record);
  if (found.length) throw new Error(`${file}:\n  ${found.join("\n  ")}`);
  return record;
}

export function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff) return diff;
  }
  return 0;
}

/** The record with an entry for `version`; a missing one starts as a copy of the newest entry. */
export function withVersion(record, version) {
  if (record[version]) return { record, copiedFrom: null };
  const newest = Object.keys(record).sort(compareVersions).at(-1);
  return { record: { ...record, [version]: structuredClone(record[newest]) }, copiedFrom: newest };
}

/** The version a platform's customers get today, from its App Store versions. */
export function liveVersion(versions) {
  return versions.find((version) => version.attributes?.appVersionState === "READY_FOR_DISTRIBUTION")?.attributes.versionString ?? null;
}

/** Per device Tomo ships: its platform's live version and that version's answers, null when none are recorded. */
export function liveAnswers(record, liveByPlatform) {
  return Object.keys(PLATFORM_OF).map((family) => {
    const version = liveByPlatform[PLATFORM_OF[family]] ?? null;
    return { family, version, answers: (version && record[version]?.[family]) || null };
  });
}

const matches = (attributes, answers, family) => offeredFeatures(family).every((feature) => (attributes?.[feature] ?? false) === answers[feature]);

/**
 * One step per device: create a draft, update the draft, or nothing, then whether that draft
 * still differs from what the store shows and so wants publishing. Only drafts can be edited.
 */
export function planDeclarations(answersByFamily, existing) {
  return Object.entries(answersByFamily).map(([family, answers]) => {
    const own = existing.filter((declaration) => declaration.attributes?.deviceFamily === family);
    const draft = own.find((declaration) => declaration.attributes?.state === "DRAFT");
    const published = own.find((declaration) => declaration.attributes?.state === "PUBLISHED");
    const live = published ? matches(published.attributes, answers, family) : false;
    if (draft) {
      const changed = offeredFeatures(family).filter((feature) => (draft.attributes?.[feature] ?? false) !== answers[feature]);
      return { family, write: changed.length ? "update" : "none", id: draft.id, changed, publish: !live };
    }
    if (live) return { family, write: "none", id: published.id, changed: [], publish: false };
    return { family, write: "create", id: null, changed: offeredFeatures(family), publish: true };
  });
}

export function createBody(appId, family, answers) {
  return {
    data: {
      type: "accessibilityDeclarations",
      attributes: { deviceFamily: family, ...Object.fromEntries(offeredFeatures(family).map((feature) => [feature, answers[feature]])) },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  };
}

export function updateBody(id, family, answers) {
  return {
    data: { type: "accessibilityDeclarations", id, attributes: Object.fromEntries(offeredFeatures(family).map((feature) => [feature, answers[feature]])) },
  };
}

export const publishBody = (id) => ({ data: { type: "accessibilityDeclarations", id, attributes: { publish: true } } });

export const summary = (answers) =>
  Object.keys(answers)
    .filter((feature) => answers[feature])
    .map((feature) => feature.replace(/^supports/, ""))
    .join(", ") || "none";
