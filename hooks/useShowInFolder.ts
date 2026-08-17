import { fetchItemFolderPath } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

/**
 * Reveal an item where it actually lives, with its own card focused on arrival (focusId).
 *
 * Pushes the path as SEPARATE routes — library, series, season — not one jump to the leaf.
 * A single push leaves a two-entry stack, so Menu drops straight back here and the levels in
 * between are unreachable; pushed level by level, Menu walks back up through them, which is
 * what makes "switch to another season" a single press from where this lands you. Each screen
 * gets the breadcrumbs of its own depth, so the header reads the same as it would if the user
 * had browsed down by hand. Only the leaf carries focusId.
 *
 * No global loader: folder navigation never uses it (only the player screens hide it again)
 * and the folder screen brings its own loading bar.
 */
export function useShowInFolder() {
  const router = useRouter();

  return useCallback(
    async (item: JellyfinItem) => {
      const path = await fetchItemFolderPath(item.Id);
      if (path.length === 0) {
        Alert.alert("Folder unavailable", "Couldn't find where this item lives on the server.");
        return;
      }
      path.forEach((level, index) => {
        const isLeaf = index === path.length - 1;
        router.push({
          pathname: "/[folderId]",
          params: {
            folderId: level.id,
            name: level.name,
            type: level.type ?? "folder",
            crumbs: JSON.stringify(path.slice(0, index + 1)),
            ...(isLeaf ? { focusId: item.Id } : {}),
          },
        });
      });
    },
    [router],
  );
}
