/**
 * Store screenshots through the App Asset Library: each file becomes one library image,
 * placed in its device's placement group on a version localization, then ordered.
 */
import fs from "node:fs";
import path from "node:path";

/** Reserve, upload every part Apple asks for, then commit. */
export async function uploadImage(api, libraryId, file) {
  const bytes = fs.readFileSync(file);
  const reservation = await api.post("/v1/appAssetLibraryImages", {
    data: {
      type: "appAssetLibraryImages",
      attributes: { category: "APP_SCREENSHOTS_AND_PREVIEWS", fileName: path.basename(file), fileSize: bytes.length },
      relationships: { assetLibrary: { data: { type: "appAssetLibraries", id: libraryId } } },
    },
  });
  const id = reservation.data.id;
  for (const operation of reservation.data.attributes.uploadOperations ?? []) {
    await api.put(operation, bytes.subarray(operation.offset, operation.offset + operation.length));
  }
  try {
    await api.patch(`/v1/appAssetLibraryImages/${id}`, { data: { type: "appAssetLibraryImages", id, attributes: { uploaded: true } } });
  } catch (e) {
    // A 5xx on commit can still commit, so the retry 409s; the asset state is the truth.
    const state = (await api.get(`/v1/appAssetLibraryImages/${id}`)).data.attributes.state;
    if (state === "AWAITING_UPLOAD" || state === "FAILED") throw e;
  }
  return id;
}

/** The group's screenshot placements on one localization, in display order. */
async function placed(api, localizationId, group) {
  const res = await api.get(
    `/v1/appStoreVersionLocalizations/${localizationId}/placements?filter[placementType]=APP_SCREENSHOT&filter[placementGroup]=${group}&sort=placementGroupPosition&include=image&limit=50`,
  );
  return res.data;
}

/**
 * Replaces the group's screenshots on one localization with `files`, in that order. The old
 * placements go first since the group has a cap, then each image no other placement uses.
 */
export async function replaceScreenshots(api, { libraryId, localizationId, group, files }) {
  for (const placement of await placed(api, localizationId, group)) {
    await api.delete(`/v1/appAssetLibraryPlacements/${placement.id}`);
    const image = placement.relationships?.image?.data?.id;
    if (image && (await api.get(`/v1/appAssetLibraryImages/${image}/placements?limit=1`)).data.length === 0) {
      await api.delete(`/v1/appAssetLibraryImages/${image}`);
    }
  }

  const ids = [];
  for (const file of files) {
    const image = await uploadImage(api, libraryId, file);
    const placement = await api.post("/v1/appAssetLibraryPlacements", {
      data: {
        type: "appAssetLibraryPlacements",
        attributes: { placementType: "APP_SCREENSHOT", placementGroup: group },
        relationships: {
          image: { data: { type: "appAssetLibraryImages", id: image } },
          appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } },
        },
      },
    });
    ids.push(placement.data.id);
  }

  await api.post("/v1/appAssetLibraryPlacementOrderingRequests", {
    data: {
      type: "appAssetLibraryPlacementOrderingRequests",
      attributes: { placementGroup: group },
      relationships: {
        orderedPlacements: { data: ids.map((id) => ({ type: "appAssetLibraryPlacements", id })) },
        appStoreVersionLocalization: { data: { type: "appStoreVersionLocalizations", id: localizationId } },
      },
    },
  });
  const shown = (await placed(api, localizationId, group)).map((p) => p.id);
  if (shown.join() !== ids.join()) throw new Error(`${group}: App Store Connect shows ${shown.length} screenshots, not the ${ids.length} uploaded, in order`);
}
