import assert from "node:assert/strict";
import { test } from "node:test";
import { submitForExternalTesting } from "../appstore/testflight.mjs";

const noDelay = { delay: async () => {} };

function fakeApi({ inReview = [], refuse = null } = {}) {
  const gets = [];
  const posts = [];
  return {
    gets,
    posts,
    get: async (url) => {
      gets.push(url);
      if (url.includes("betaReviewState")) return { data: inReview };
      return { data: [{ id: "b51", attributes: { version: "51", processingState: "VALID" } }] };
    },
    post: async (url, body) => {
      if (refuse && url === "/v1/betaAppReviewSubmissions") throw new Error(refuse);
      posts.push([url, body]);
      return null;
    },
  };
}

test("a free review slot submits the build, then adds it to the external group", async () => {
  const api = fakeApi();
  const result = await submitForExternalTesting(api, "app", "IOS", "2.2.15", "51", "group", noDelay);
  assert.equal(result.submitted, true);
  assert.deepEqual(api.posts, [
    ["/v1/betaAppReviewSubmissions", { data: { type: "betaAppReviewSubmissions", relationships: { build: { data: { type: "builds", id: "b51" } } } } }],
    ["/v1/betaGroups/group/relationships/builds", { data: [{ type: "builds", id: "b51" }] }],
  ]);
});

test("a build of the same version in review means nothing is submitted", async () => {
  const api = fakeApi({ inReview: [{ id: "b50", attributes: { version: "50" } }] });
  const result = await submitForExternalTesting(api, "app", "TV_OS", "2.2.15", "51", "group", noDelay);
  assert.deepEqual(result, { submitted: false, reason: "TV_OS 2.2.15: build 50 in review, 51 not submitted" });
  assert.deepEqual(api.posts, []);
});

test("the review slot is looked up for the build's own version and platform", async () => {
  const api = fakeApi();
  await submitForExternalTesting(api, "app", "MAC_OS", "2.2.15", "51", "group", noDelay);
  const query = api.gets.find((url) => url.includes("betaReviewState"));
  assert.match(query, /filter\[betaAppReviewSubmission.betaReviewState\]=WAITING_FOR_REVIEW,IN_REVIEW/);
  assert.match(query, /filter\[expired\]=false/);
  assert.match(query, /filter\[preReleaseVersion.version\]=2.2.15/);
  assert.match(query, /filter\[preReleaseVersion.platform\]=MAC_OS/);
});

test("a submission Apple refuses is reported and the build is not added to the group", async () => {
  const api = fakeApi({ refuse: "POST /v1/betaAppReviewSubmissions -> HTTP 409: too many builds" });
  const result = await submitForExternalTesting(api, "app", "IOS", "2.2.15", "51", "group", noDelay);
  assert.equal(result.submitted, false);
  assert.match(result.reason, /IOS 2.2.15: build 51 not submitted, .*HTTP 409: too many builds/);
  assert.deepEqual(api.posts, []);
});

test("a build still processing after every attempt is not submitted", async () => {
  const api = {
    get: async () => ({ data: [{ id: "b51", attributes: { version: "51", processingState: "PROCESSING" } }] }),
    post: async () => assert.fail("nothing is posted"),
  };
  const result = await submitForExternalTesting(api, "app", "IOS", "2.2.15", "51", "group", { attempts: 2, ...noDelay });
  assert.deepEqual(result, { submitted: false, reason: "IOS 2.2.15: build 51 is still processing or missing, not submitted" });
});
