/** External TestFlight: a build goes to beta review only while no other build of its version and platform is there. */
import { processedBuild } from "./platforms.mjs";

export async function buildInReview(api, appId, platform, version) {
  const found = await api.get(
    `/v1/builds?filter[app]=${appId}&filter[betaAppReviewSubmission.betaReviewState]=WAITING_FOR_REVIEW,IN_REVIEW&filter[expired]=false&filter[preReleaseVersion.version]=${version}&filter[preReleaseVersion.platform]=${platform}&limit=1`,
  );
  return found.data[0] ?? null;
}

export async function submitForExternalTesting(api, appId, platform, version, buildNumber, groupId, options = {}) {
  const build = await processedBuild(api, appId, platform, version, buildNumber, options);
  if (!build) return { submitted: false, reason: `${platform} ${version}: build ${buildNumber} is still processing or missing, not submitted` };
  const inReview = await buildInReview(api, appId, platform, version);
  if (inReview) return { submitted: false, reason: `${platform} ${version}: build ${inReview.attributes.version} in review, ${buildNumber} not submitted` };
  try {
    await api.post("/v1/betaAppReviewSubmissions", {
      data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: build.id } } } },
    });
  } catch (e) {
    return { submitted: false, reason: `${platform} ${version}: build ${buildNumber} not submitted, ${e.message}` };
  }
  await api.post(`/v1/betaGroups/${groupId}/relationships/builds`, { data: [{ type: "builds", id: build.id }] });
  return { submitted: true, reason: `${platform} ${version}: build ${buildNumber} submitted for beta review` };
}
