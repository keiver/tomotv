import { fetchItemFolderPath } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import { useNavigationContainerRef, useRouter } from "expo-router";
import { useCallback } from "react";
import { Alert } from "react-native";

type ContainerRef = ReturnType<typeof useNavigationContainerRef>;

/** Ceiling on the settle wait, so a press can never hang on a state event that never comes. */
const DISMISS_SETTLE_TIMEOUT_MS = 400;

/**
 * Resolve once the container reports a root state other than `from`.
 *
 * expo-router resolves a link against `getRootState()` when it DRAINS its routing queue
 * (getNavigationAction.js:19), and one drain empties the whole queue (routingQueue.run). A push
 * queued in the same tick as the dismissal is therefore computed while the dismissing screen is
 * still on top of the ROOT stack: it diverges there and forks a second (tabs) instance instead of
 * pushing into the library's own stack. Waiting for the pop to land puts the push in a later drain.
 */
function whenRootStateSettles(ref: ContainerRef, from: unknown): Promise<void> {
  return new Promise<void>((resolve) => {
    if (!ref.isReady() || ref.getRootState() !== from) {
      resolve();
      return;
    }
    let unsubscribe = () => {};
    const timer = setTimeout(() => {
      unsubscribe();
      resolve();
    }, DISMISS_SETTLE_TIMEOUT_MS);
    unsubscribe = ref.addListener("state", () => {
      clearTimeout(timer);
      unsubscribe();
      resolve();
    });
  });
}

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
 * `dismissFirst` is for a caller on a ROOT route (the info panel): the dismissal happens here,
 * ahead of the pushes and after the ancestors are in hand, because only this function can wait
 * for it to reach the navigation state before the pushes are queued.
 *
 * No global loader: folder navigation never uses it (only the player screens hide it again)
 * and the folder screen brings its own loading bar.
 */
export function useShowInFolder() {
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();

  return useCallback(
    async (item: JellyfinItem, options?: { dismissFirst?: boolean }) => {
      const path = await fetchItemFolderPath(item.Id);
      if (path.length === 0) {
        Alert.alert("Folder unavailable", "Couldn't find where this item lives on the server.");
        return;
      }

      if (options?.dismissFirst) {
        const before = navigationRef.isReady() ? navigationRef.getRootState() : undefined;
        router.back();
        await whenRootStateSettles(navigationRef, before);
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
    [router, navigationRef],
  );
}
