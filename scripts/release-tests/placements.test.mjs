import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { replaceScreenshots } from "../appstore/placements.mjs";

function files(t, names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-placements-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return names.map((name) => {
    const file = path.join(dir, name);
    fs.writeFileSync(file, Buffer.alloc(10, name));
    return file;
  });
}

/** App Store Connect with two old placements; the second one's image is also placed on another surface. */
function fakeApi({ shownOrder } = {}) {
  const calls = [];
  let created = 0;
  let placedIds = null;
  const api = {
    calls,
    get: async (url) => {
      calls.push(["GET", url]);
      if (url.includes("/appStoreVersionLocalizations/loc/placements")) {
        if (!placedIds) {
          return {
            data: [
              { id: "old-1", relationships: { image: { data: { id: "img-1" } } } },
              { id: "old-2", relationships: { image: { data: { id: "img-2" } } } },
            ],
          };
        }
        return { data: (shownOrder ?? placedIds).map((id) => ({ id })) };
      }
      if (url.startsWith("/v1/appAssetLibraryImages/img-1/placements")) return { data: [] };
      if (url.startsWith("/v1/appAssetLibraryImages/img-2/placements")) return { data: [{ id: "elsewhere" }] };
      throw new Error(`unexpected GET ${url}`);
    },
    post: async (url, body) => {
      calls.push(["POST", url, body]);
      if (url === "/v1/appAssetLibraryImages") {
        created++;
        return { data: { id: `new-img-${created}`, attributes: { uploadOperations: [{ offset: 0, length: 10 }] } } };
      }
      if (url === "/v1/appAssetLibraryPlacements") return { data: { id: `p-${body.data.relationships.image.data.id}` } };
      if (url === "/v1/appAssetLibraryPlacementOrderingRequests") {
        placedIds = body.data.relationships.orderedPlacements.data.map((p) => p.id);
        return { data: { id: "order" } };
      }
      throw new Error(`unexpected POST ${url}`);
    },
    patch: async (url, body) => calls.push(["PATCH", url, body]),
    delete: async (url) => calls.push(["DELETE", url]),
    put: async (operation, slice) => calls.push(["PUT", slice.length]),
  };
  return api;
}

test("replacing a group removes its old placements, then only the images nothing else uses", async (t) => {
  const api = fakeApi();
  await replaceScreenshots(api, { libraryId: "lib", localizationId: "loc", group: "IPHONE_DUO_PROFILE", files: files(t, ["01-library.png"]) });
  const deletes = api.calls.filter((c) => c[0] === "DELETE").map((c) => c[1]);
  assert.deepEqual(deletes, ["/v1/appAssetLibraryPlacements/old-1", "/v1/appAssetLibraryImages/img-1", "/v1/appAssetLibraryPlacements/old-2"]);
  const firstUpload = api.calls.findIndex((c) => c[1] === "/v1/appAssetLibraryImages" && c[0] === "POST");
  assert.ok(api.calls.findLastIndex((c) => c[0] === "DELETE") < firstUpload);
});

test("each file is uploaded to the library, committed without a checksum, placed and ordered as given", async (t) => {
  const api = fakeApi();
  await replaceScreenshots(api, { libraryId: "lib", localizationId: "loc", group: "IPHONE_DUO_PROFILE", files: files(t, ["01-library.png", "02-player.png"]) });
  const reserve = api.calls.find((c) => c[1] === "/v1/appAssetLibraryImages");
  assert.deepEqual(reserve[2].data.attributes, { category: "APP_SCREENSHOTS_AND_PREVIEWS", fileName: "01-library.png", fileSize: 10 });
  assert.equal(reserve[2].data.relationships.assetLibrary.data.id, "lib");
  assert.deepEqual(api.calls.find((c) => c[0] === "PATCH")[2].data.attributes, { uploaded: true });
  const placement = api.calls.find((c) => c[1] === "/v1/appAssetLibraryPlacements")[2].data;
  assert.deepEqual(placement.attributes, { placementType: "APP_SCREENSHOT", placementGroup: "IPHONE_DUO_PROFILE" });
  assert.equal(placement.relationships.appStoreVersionLocalization.data.id, "loc");
  const order = api.calls.find((c) => c[1] === "/v1/appAssetLibraryPlacementOrderingRequests")[2].data;
  assert.equal(order.attributes.placementGroup, "IPHONE_DUO_PROFILE");
  assert.deepEqual(
    order.relationships.orderedPlacements.data.map((p) => p.id),
    ["p-new-img-1", "p-new-img-2"],
  );
});

test("an order App Store Connect does not show back stops the upload", async (t) => {
  const api = fakeApi({ shownOrder: ["p-new-img-2", "p-new-img-1"] });
  await assert.rejects(
    replaceScreenshots(api, { libraryId: "lib", localizationId: "loc", group: "MAC_PROFILE", files: files(t, ["01-library.png", "02-player.png"]) }),
    /not the 2 uploaded, in order/,
  );
});
