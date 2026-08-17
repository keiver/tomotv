import { MediaShelf } from "@/components/media-shelf";
import { VideoGridItem } from "@/components/video-grid-item";
import { ArtworkSlotShape, artworkSlotShape } from "@/constants/app";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { clearResumePosition, fetchItemFolderPath, fetchResumeItems, subscribeResumeChange } from "@/services/jellyfinApi";
import { containerKey, dismissNextUpContainer, resolveNextUp } from "@/services/nextUp";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";

interface ResumeItem {
  video: JellyfinVideoItem;
  progressPercent: number; // 0–1
}

interface ContinueWatchingRowProps {
  /**
   * Focus handler for the shelf's cards, supplied by the host screen — the same one its own
   * cards get. It drives the poster backdrop, and that belongs to the screen, not to this row.
   */
  onItemFocus?: (video: JellyfinVideoItem, index: number) => void;
}

/**
 * The Continue shelf: what you were watching, resumable from the server's resume list.
 * Self-contained: loads on focus and renders nothing when empty. Resume positions are
 * server-side UserData (synced by playback reporting), so the row matches every other
 * Jellyfin client.
 *
 * The resume list alone can't carry a binge: an item leaves it as soon as the server marks
 * it played, so finishing an episode used to take the whole series off the row. Next-up
 * cards (services/nextUp.ts) fill that gap, appended after the resumable ones.
 */
export function ContinueWatchingRow({ onItemFocus }: ContinueWatchingRowProps) {
  const router = useRouter();
  const openItem = useOpenShelfItem();
  const [hasItems, setHasItems] = useState(false);
  const [items, setItems] = useState<ResumeItem[]>([]);
  // The next-up tail, held outside state so a reload can rebuild the full list in one pass
  // (resume cards + tail) instead of reading `items` back inside an updater.
  const nextUpRef = useRef<ResumeItem[]>([]);

  const show = useCallback((next: ResumeItem[]) => {
    setItems(next);
    setHasItems(next.length > 0);
  }, []);

  // Reload each time the Library tab regains focus (e.g. after returning from the player),
  // and again whenever the resume state is rewritten while this screen stays focused. The
  // focus-time fetch can race the reporter's session-closing writes — a Resume query the
  // server answers DURING Sessions/Stopped processing transiently omits the just-played item
  // — so the write-completion signal (subscribeResumeChange) schedules a refetch that always
  // runs after the last write landed. Trailing debounce: a back-out fires Stopped + persist
  // ~100ms apart; only the final signal of the burst should hit the network.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      let reloadTimer: ReturnType<typeof setTimeout> | null = null;
      // A focus and a write-completion signal can overlap, and each load spans two awaits
      // (resume list, then next-up resolution). Only the newest load may write, or a slow
      // earlier one lands its stale list on top of the fresh one.
      let latestLoad = 0;

      const load = async () => {
        const loadId = ++latestLoad;
        const superseded = () => cancelled || loadId !== latestLoad;

        // null = transient failure, which must not hide a row that was showing items;
        // only a genuinely empty resume list collapses it.
        const resumeItems = await fetchResumeItems(20);
        if (resumeItems === null) {
          logger.debug("CW row fetch null — keeping previous items", { service: "ContinueWatching" });
        } else {
          logger.debug("CW row fetch", {
            service: "ContinueWatching",
            count: resumeItems.length,
            items: resumeItems.map((v) => ({
              id: v.Id.slice(0, 8),
              name: v.Name?.slice(0, 24),
              pos: Math.round((v.UserData?.PlaybackPositionTicks ?? 0) / 10000000),
              played: v.UserData?.Played,
            })),
          });
        }
        if (superseded() || resumeItems === null) return;

        const merged: ResumeItem[] = resumeItems.map((video) => ({
          video,
          progressPercent: video.RunTimeTicks && video.RunTimeTicks > 0 ? (video.UserData?.PlaybackPositionTicks ?? 0) / video.RunTimeTicks : (video.UserData?.PlayedPercentage ?? 0) / 100,
        }));

        // Paint the resume cards first, keeping the previous next-up tail in place so the row
        // doesn't flash while it re-resolves. A container that just became resumable drops its
        // stale next-up card immediately — the resume card supersedes it.
        const resumeContainers = new Set(resumeItems.map(containerKey).filter((key): key is string => !!key));
        nextUpRef.current = nextUpRef.current.filter((entry) => !resumeContainers.has(containerKey(entry.video) ?? ""));
        show([...merged, ...nextUpRef.current]);

        const nextUp = await resolveNextUp(resumeItems);
        if (superseded()) return;

        nextUpRef.current = nextUp.map<ResumeItem>((video) => ({ video, progressPercent: 0 }));
        show([...merged, ...nextUpRef.current]);
      };

      const scheduleReload = () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          if (!cancelled) load();
        }, 250);
      };

      // Focus regain happens mid pop-transition (returning from the player), so the fetch
      // kick-off is deferred a tick to keep its setState out of that commit. A tick is all
      // it ever was: this called InteractionManager, which RN 0.85 ships as a setImmediate
      // stub that does not wait for the animation the previous comment claimed.
      const interaction = setImmediate(() => {
        if (!cancelled) load();
      });
      const unsubscribe = subscribeResumeChange(scheduleReload);

      return () => {
        cancelled = true;
        clearImmediate(interaction);
        unsubscribe();
        if (reloadTimer) clearTimeout(reloadTimer);
      };
    }, [show]),
  );

  const removeItem = useCallback(async (video: JellyfinVideoItem) => {
    // Next-up cards are held by the tail ref, so membership there IS the card's source.
    const isNextUp = nextUpRef.current.some((entry) => entry.video.Id === video.Id);

    // Optimistic removal; if the server call fails the item reappears on next focus
    setItems((prev) => {
      const next = prev.filter((entry) => entry.video.Id !== video.Id);
      setHasItems(next.length > 0);
      return next;
    });

    if (isNextUp) {
      // Nothing to clear server-side — the item was never started, so DELETE /PlayedItems
      // would be a no-op and the card would come straight back on the next focus. Suppress
      // the whole container for this session instead.
      nextUpRef.current = nextUpRef.current.filter((entry) => entry.video.Id !== video.Id);
      const container = containerKey(video);
      if (container) dismissNextUpContainer(container);
      return;
    }

    try {
      await clearResumePosition(video.Id);
    } catch (err) {
      logger.warn("Failed to remove continue watching item", err, { service: "ContinueWatching" });
    }
  }, []);

  /**
   * Reveal this item where it actually lives, with its own card focused on arrival (focusId).
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
  const showInFolder = useCallback(
    async (video: JellyfinVideoItem) => {
      const path = await fetchItemFolderPath(video.Id);
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
            ...(isLeaf ? { focusId: video.Id } : {}),
          },
        });
      });
    },
    [router],
  );

  const handleLongPress = useCallback(
    (video: JellyfinVideoItem) => {
      // Titled with the item, not the removal question: the sheet is now about the card as a
      // whole, and destructive styling already marks which option removes it.
      Alert.alert(video.Name || "Video", undefined, [
        { text: "Show In Folder", onPress: () => showInFolder(video) },
        { text: "Remove Progress", style: "destructive", onPress: () => removeItem(video) },
        { text: "Cancel", style: "cancel" },
      ]);
    },
    [removeItem, showInFolder],
  );

  const renderItem = useCallback(
    // Mixed shapes on one row height: episode thumbs stay wide, a movie's resume card is its
    // poster, album art is square — never letterboxed (fitArtwork).
    (item: ResumeItem, index: number, cardHeight: number) => (
      <VideoGridItem
        video={item.video}
        onPress={openItem}
        onLongPress={handleLongPress}
        onItemFocus={onItemFocus}
        index={index}
        cardHeight={cardHeight}
        fitArtwork
        progressPercent={item.progressPercent}
        slotOrientation="landscape"
      />
    ),
    [openItem, handleLongPress, onItemFocus],
  );

  const keyExtractor = useCallback((item: ResumeItem) => item.video.Id, []);

  const slotShapeFor = useCallback((item: ResumeItem): ArtworkSlotShape => (item.video.PrimaryImageAspectRatio ? artworkSlotShape(item.video.PrimaryImageAspectRatio) : "landscape"), []);

  if (!hasItems) {
    return null;
  }

  return <MediaShelf title="Continue" data={items} slotShapeFor={slotShapeFor} renderItem={renderItem} keyExtractor={keyExtractor} />;
}
