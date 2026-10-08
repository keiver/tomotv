/** One platform vocabulary for composition, listing text, and build selection. */
export const PLATFORM_LABELS = { IOS: "iOS", MAC_OS: "macOS", TV_OS: "tvOS" };
export const PLATFORMS = Object.keys(PLATFORM_LABELS);
export const DISPLAY_TYPES = {
  iphone: { platform: "IOS", type: "APP_IPHONE_67", size: "1320x2868" },
  ipad: { platform: "IOS", type: "APP_IPAD_PRO_3GEN_129", size: "2064x2752" },
  mac: { platform: "MAC_OS", type: "APP_DESKTOP", size: "2880x1800" },
  tv: { platform: "TV_OS", type: "APP_APPLE_TV", size: "3840x2160" },
};

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
