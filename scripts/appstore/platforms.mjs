/** One platform vocabulary for composition, listing text, and build selection. */
export const PLATFORM_LABELS = { IOS: "iOS", MAC_OS: "macOS", TV_OS: "tvOS" };
export const PLATFORMS = Object.keys(PLATFORM_LABELS);
/** Each device's App Store and display class; the placement group comes from Apple's reference data. */
export const SCREENSHOT_DEVICES = {
  iphone: { platform: "IOS", store: "IPHONE_APP_STORE", displayClass: "IPHONE_DYNAMIC_ISLAND_LARGE_DISPLAY", size: "1320x2868" },
  ipad: { platform: "IOS", store: "IPAD_APP_STORE", displayClass: "IPAD_13_DISPLAY", size: "2064x2752" },
  mac: { platform: "MAC_OS", store: "MAC_APP_STORE", displayClass: "DEFAULT", size: "2880x1800" },
  tv: { platform: "TV_OS", store: "TV_APP_STORE", displayClass: "DEFAULT", size: "3840x2160" },
  duo: { platform: "IOS", store: "IPHONE_APP_STORE", displayClass: "IPHONE_DUO", size: "2853x2007" },
};

/** Whether a group takes a size. Apple's screenshot specifications list each size in both orientations. */
export function acceptsSize(sizes, size) {
  const key = (s) =>
    s
      .split("x")
      .map(Number)
      .sort((a, b) => a - b)
      .join("x");
  return sizes.some((s) => key(s) === key(size));
}

/** Configured devices the store takes screenshots for, minus any the config marks `"upload": false`. */
export function uploadedDevices(config, platforms = PLATFORMS) {
  return Object.keys(config.devices).filter((key) => SCREENSHOT_DEVICES[key] && config.devices[key].upload !== false && platforms.includes(SCREENSHOT_DEVICES[key].platform));
}

/** The device's screenshot placement group, the sizes it accepts and how many it holds, from `GET /v1/appAssetLibraryRefData`. */
export function placementGroup(refData, deviceKey) {
  const { store, displayClass } = SCREENSHOT_DEVICES[deviceKey];
  const ref = refData.data[0].attributes;
  const profile = ref.placementProfileGroups.find((g) => g.platform === store && g.displayClassId === displayClass);
  if (!profile) throw new Error(`${deviceKey}: App Store Connect lists no ${store} placement group for ${displayClass}`);
  const group = profile.placementProfileGroupId;
  const mapping = ref.placementTypes.find((t) => t.placementTypeId === "APP_SCREENSHOT")?.specMappings.find((m) => m.placementGroupId === group);
  if (!mapping) throw new Error(`${deviceKey}: ${group} takes no screenshots`);
  const sizes = mapping.specs
    .map((id) => ref.imageSpecs.find((s) => s.specId === id)?.dimensions)
    .filter(Boolean)
    .map((d) => `${d.minWidth}x${d.minHeight}`);
  const policy = ref.features.find((f) => f.featureId === "APP_STORE_VERSIONS")?.placementPolicies.find((p) => p.placementType === "APP_SCREENSHOT");
  const maxCount = policy?.groupLimits.find((l) => l.groupIds.includes(group))?.maxCount;
  if (!maxCount) throw new Error(`${deviceKey}: App Store Connect lists no screenshot limit for ${group}`);
  return { group, sizes, maxCount };
}

export function selectedPlatforms(value) {
  const platforms = value ? value.split(",") : PLATFORMS;
  for (const platform of platforms) {
    if (!PLATFORMS.includes(platform)) throw new Error(`Unknown platform ${platform}. Use ${PLATFORMS.join(", ")}.`);
  }
  return [...new Set(platforms)];
}

export async function platformVersions(api, appId, platform) {
  let endpoint = `/v1/apps/${appId}/appStoreVersions?filter[platform]=${platform}&limit=200`;
  const versions = [];
  while (endpoint) {
    const page = await api.get(endpoint);
    versions.push(...page.data);
    endpoint = page.links?.next;
  }
  return versions;
}

const RELEASED = new Set(["READY_FOR_SALE", "READY_FOR_DISTRIBUTION", "REMOVED_FROM_SALE", "DEVELOPER_REMOVED_FROM_SALE", "REPLACED_WITH_NEW_VERSION"]);

/** Apple doesn't expose What's New on a platform's first version. */
export function isFirstVersion(versions, version) {
  return !versions.some((v) => v.attributes.versionString !== version && (v.attributes.downloadable || RELEASED.has(v.attributes.appStoreState)));
}

export function editableVersion(versions, platform, version) {
  const draft = versions.find((v) => v.attributes.appStoreState === "PREPARE_FOR_SUBMISSION");
  if (draft && draft.attributes.versionString !== version) throw new Error(`${platform} draft is ${draft.attributes.versionString}, app.json says ${version}`);
  return draft;
}

export async function attachBuild(api, appId, platform, version, buildNumber, { attempts = 30, delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  const draft = editableVersion(await platformVersions(api, appId, platform), platform, version);
  if (!draft) throw new Error(`No editable ${platform} version. Run shots:upload -- --create-version first.`);
  for (let attempt = 0; attempt < attempts; attempt++) {
    const builds = await api.get(`/v1/builds?filter[app]=${appId}&filter[version]=${buildNumber}&filter[preReleaseVersion.version]=${version}&filter[preReleaseVersion.platform]=${platform}&limit=1`);
    const build = builds.data[0];
    const state = build?.attributes.processingState;
    if (state === "VALID") {
      await api.patch(`/v1/appStoreVersions/${draft.id}/relationships/build`, { data: { type: "builds", id: build.id } });
      const selected = await api.get(`/v1/appStoreVersions/${draft.id}/build`);
      if (selected.data?.id !== build.id) throw new Error(`${platform}: App Store Connect did not keep build ${buildNumber} on ${version}`);
      return build;
    }
    if (state && state !== "PROCESSING") throw new Error(`${platform}: build ${buildNumber} is ${state}`);
    if (attempt + 1 < attempts) await delay(30000);
  }
  throw new Error(`${platform}: build ${buildNumber} for ${version} is still processing or missing. Re-run appstore-attach-build after Apple finishes processing.`);
}
