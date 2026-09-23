import { JellyfinFolderResponse, JellyfinItem } from "@/types/jellyfin";
import { API_TIMEOUTS, INCLUDED_LOCATION_TYPES } from "./constants";
import { fetchWithTimeout } from "./http";
import { getAuthHeader, JellyfinConfig, throwRequestError } from "./session";

/**
 * Collect EVERY item of a paged /Items query (500 per page), the shared loop behind
 * the id-set and leaf-list fetchers. `buildQuery` returns the full parameter set for one page;
 * this drives StartIndex/Limit, aborts each page at API_TIMEOUTS.EXTENDED, and THROWS on any
 * failed page so a partial set is never mistaken for a complete one. `label` names the set in
 * error messages ("Failed to fetch <label>: 500" / "Request timed out fetching <label>.").
 */
export async function fetchAllItemPages(config: JellyfinConfig, buildQuery: (startIndex: number, limit: number) => URLSearchParams, label: string): Promise<JellyfinItem[]> {
  const PAGE_SIZE = 500;
  const all: JellyfinItem[] = [];
  let startIndex = 0;
  let hasMore = true;

  while (hasMore) {
    // Stamped here rather than in every caller's buildQuery: this loop is the only
    // way any of them reach the server (INCLUDED_LOCATION_TYPES).
    const query = buildQuery(startIndex, PAGE_SIZE);
    query.set("LocationTypes", INCLUDED_LOCATION_TYPES);
    const url = `${config.server}/Items?userId=${config.userId}&${query.toString()}`;

    try {
      const response = await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            Authorization: getAuthHeader(config.deviceId, config.apiKey),
          },
        },
        API_TIMEOUTS.EXTENDED,
      );

      if (!response.ok) {
        throwRequestError(response, `Failed to fetch ${label}: ${response.status}`);
      }

      const data: JellyfinFolderResponse = await response.json();
      const items = data.Items || [];
      all.push(...items);

      const total = data.TotalRecordCount;
      startIndex += items.length;
      hasMore = items.length === PAGE_SIZE && (total === undefined || startIndex < total);
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`Request timed out fetching ${label}.`);
      }
      throw error;
    }
  }

  return all;
}
