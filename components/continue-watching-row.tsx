import { VideoGridItem } from "@/components/video-grid-item";
import { GRID, slotColumns, slotRatio } from "@/constants/app";
import { useLoading } from "@/contexts/LoadingContext";
import { usePlayQueue } from "@/contexts/PlayQueueContext";
import { clearResumePosition, fetchResumeItems, subscribeResumeChange } from "@/services/jellyfinApi";
import { containerKey, dismissNextUpContainer, resolveNextUp } from "@/services/nextUp";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Alert, Dimensions, FlatList, Platform, StyleSheet, Text, View } from "react-native";

// Mirror the Library grid sizing so shelf cards match a landscape grid column.
const IS_TV = Platform.isTV;
const NUM_COLUMNS = slotColumns("landscape", IS_TV);
const GRID_PADDING_H = (IS_TV ? GRID.SIDE_PADDING.tv : GRID.SIDE_PADDING.phone) + (IS_TV ? 40 : 20);
const CARD_PADDING = IS_TV ? 16 : 6;

const CARD_WIDTH = (Dimensions.get("window").width - GRID_PADDING_H) / NUM_COLUMNS;
// Deterministic card height (landscape slot) so we can reserve the row's space
// up front and avoid a layout jump when the async metadata finishes loading.
const CARD_HEIGHT = Math.round((CARD_WIDTH - 2 * CARD_PADDING) / slotRatio("landscape") + 2 * CARD_PADDING);
// Extra room around the list so the focused card's glow isn't clipped at the
// FlatList bounds; negative margins cancel it out so the layout doesn't move.
const GLOW_PAD = IS_TV ? 24 : 12;

interface ResumeItem {
  video: JellyfinVideoItem;
  progressPercent: number; // 0–1
  /** "resume" = server resume list; "nextUp" = derived first-unplayed after a finished item. */
  source: "resume" | "nextUp";
}

/**
 * Horizontal "Continue Watching" shelf shown at the top of the Library root.
 * Self-contained: loads the server's resume list on focus and renders nothing when
 * empty. Resume positions are server-side UserData (synced by playback reporting),
 * so the row matches every other Jellyfin client.
 *
 * The resume list alone can't carry a binge: an item leaves it as soon as the server marks
 * it played, so finishing an episode used to take the whole series off the row. Next-up
 * cards (services/nextUp.ts) fill that gap, appended after the resumable ones.
 */
export function ContinueWatchingRow() {
  const router = useRouter();
  const { showGlobalLoader } = useLoading();
  const { buildQueue } = usePlayQueue();
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
          source: "resume",
        }));

        // Paint the resume cards first, keeping the previous next-up tail in place so the row
        // doesn't flash while it re-resolves. A container that just became resumable drops its
        // stale next-up card immediately — the resume card supersedes it.
        const resumeContainers = new Set(resumeItems.map(containerKey).filter((key): key is string => !!key));
        nextUpRef.current = nextUpRef.current.filter((entry) => !resumeContainers.has(containerKey(entry.video) ?? ""));
        show([...merged, ...nextUpRef.current]);

        const nextUp = await resolveNextUp(resumeItems);
        if (superseded()) return;

        nextUpRef.current = nextUp.map<ResumeItem>((video) => ({ video, progressPercent: 0, source: "nextUp" }));
        show([...merged, ...nextUpRef.current]);
      };

      const scheduleReload = () => {
        if (reloadTimer) clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => {
          reloadTimer = null;
          if (!cancelled) load();
        }, 250);
      };

      load();
      const unsubscribe = subscribeResumeChange(scheduleReload);

      return () => {
        cancelled = true;
        unsubscribe();
        if (reloadTimer) clearTimeout(reloadTimer);
      };
    }, [show]),
  );

  const handlePress = useCallback(
    (video: JellyfinVideoItem) => {
      showGlobalLoader();
      // Binge mode for every item type: series-wide for episodes, folder siblings
      // for everything else (audio included). No queue only when no parent is known.
      const queueParent = video.SeriesId ?? video.ParentId;
      if (queueParent) {
        buildQueue(queueParent, video.SeriesName ?? video.Name, video.Id);
      }
      router.push({
        pathname: "/player" as const,
        params: {
          videoId: video.Id,
          videoName: video.Name,
          ...(queueParent ? { queueMode: "true" } : {}),
          // Trust the state this row just displayed over the player's own item
          // refetch: the item endpoint can answer with stale/contradictory
          // UserData (2026-08-05: played:true + position 0 for an item the
          // resume list reported at 1521s, wiping the position on rewatch).
          ...(video.UserData?.PlaybackPositionTicks ? { startTicks: String(video.UserData.PlaybackPositionTicks) } : {}),
          played: video.UserData?.Played ? "true" : "false",
        },
      });
    },
    [showGlobalLoader, router, buildQueue],
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

  const handleLongPress = useCallback(
    (video: JellyfinVideoItem) => {
      Alert.alert("Remove from Continue Watching?", video.Name || undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => removeItem(video) },
      ]);
    },
    [removeItem],
  );

  const renderItem = useCallback(
    ({ item, index }: { item: ResumeItem; index: number }) => (
      <VideoGridItem video={item.video} onPress={handlePress} onLongPress={handleLongPress} index={index} cardWidth={CARD_WIDTH} progressPercent={item.progressPercent} slotOrientation="landscape" />
    ),
    [handlePress, handleLongPress],
  );

  if (!hasItems) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Text style={styles.heading}>Continue Watching</Text>
      </View>
      {/* Fixed height keeps the layout stable while a focus-triggered reload swaps items. */}
      <View style={styles.rowArea}>
        <FlatList
          data={items}
          renderItem={renderItem}
          keyExtractor={(item) => item.video.Id}
          horizontal
          showsHorizontalScrollIndicator={false}
          removeClippedSubviews={false}
          contentContainerStyle={styles.rowContent}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: IS_TV ? 0 : 24,
    marginBottom: IS_TV ? 24 : 24,
  },
  headingRow: {
    flexDirection: "row",
    alignItems: "baseline",
    marginLeft: CARD_PADDING,
    marginBottom: IS_TV ? 12 : 8,
  },
  heading: {
    fontSize: IS_TV ? 28 : 18,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  rowArea: {
    height: CARD_HEIGHT + 2 * GLOW_PAD,
    margin: -GLOW_PAD,
  },
  rowContent: {
    padding: GLOW_PAD,
  },
});
