import { MediaShelf } from "@/components/media-shelf";
import { VideoGridItem } from "@/components/video-grid-item";
import { ArtworkSlotShape, itemSlotShape } from "@/constants/app";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { fetchResumeItems, subscribeResumeChange } from "@/services/jellyfinApi";
import { containerKey, resolveNextUp } from "@/services/nextUp";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";

const IS_TV = Platform.isTV;

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

  const isScreenFocused = useIsFocused();

  // The card the info panel was opened from, the card the row launched into the player, and the
  // leading card's pending focus claim.
  const panelItemIdRef = useRef<string | null>(null);
  const launchedItemIdRef = useRef<string | null>(null);
  const [focusFirstCard, setFocusFirstCard] = useState(false);
  const focusFirstRef = useRef(false);
  const claimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const retireClaim = useCallback(() => {
    if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
    claimTimerRef.current = null;
    if (!focusFirstRef.current) return;
    focusFirstRef.current = false;
    setFocusFirstCard(false);
  }, []);
  useEffect(() => () => retireClaim(), [retireClaim]);

  /**
   * The row re-ranks on the way back: the server lists what played last first, so the card the
   * viewer left from leads. Fabric's reorder drops UIKit's restoration to the far end of the row,
   * so the leading card claims focus, re-raised on every layout pass until it lands.
   */
  const claimFirstCard = useCallback(() => {
    focusFirstRef.current = true;
    setFocusFirstCard(true);
    if (claimTimerRef.current) clearTimeout(claimTimerRef.current);
    claimTimerRef.current = setTimeout(retireClaim, 1500);
  }, [retireClaim]);

  // Retires the claim the moment focus is anywhere in the row.
  const handleItemFocus = useCallback(
    (video: JellyfinVideoItem, index: number) => {
      if (IS_TV) retireClaim();
      onItemFocus?.(video, index);
    },
    [onItemFocus, retireClaim],
  );

  const show = useCallback(
    (incoming: ResumeItem[]) => {
      setItems(incoming);
      setHasItems(incoming.length > 0);
      const anchorId = panelItemIdRef.current ?? launchedItemIdRef.current;
      panelItemIdRef.current = null;
      launchedItemIdRef.current = null;
      // Back from a card this row opened: it now leads the list, so focus goes to the front.
      if (IS_TV && anchorId) claimFirstCard();
    },
    [claimFirstCard],
  );

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

  // Which card the viewer is coming back to, for the reload that lands on the way back.
  const handlePress = useCallback(
    (video: JellyfinVideoItem) => {
      launchedItemIdRef.current = video.Id;
      openItem(video);
    },
    [openItem],
  );

  // fromResume adds the panel's "Remove Progress" action; the row refetches on the
  // resume-change signal the removal fires, so no local removal is needed here.
  const handleLongPress = useCallback(
    (video: JellyfinVideoItem) => {
      panelItemIdRef.current = video.Id;
      router.push({ pathname: "/video-info", params: { videoId: video.Id, name: video.Name, fromResume: "1" } });
    },
    [router],
  );

  const renderItem = useCallback(
    // Mixed shapes on one row height: episode thumbs stay wide, a movie's resume card is its
    // poster, album art is square — never letterboxed (fitArtwork).
    (item: ResumeItem, index: number, cardHeight: number) => (
      <VideoGridItem
        video={item.video}
        onPress={handlePress}
        onLongPress={handleLongPress}
        onItemFocus={handleItemFocus}
        hasTVPreferredFocus={index === 0 && focusFirstCard && isScreenFocused}
        index={index}
        cardHeight={cardHeight}
        fitArtwork
        progressPercent={item.progressPercent}
        slotOrientation="landscape"
      />
    ),
    [handlePress, handleLongPress, handleItemFocus, focusFirstCard, isScreenFocused],
  );

  const keyExtractor = useCallback((item: ResumeItem) => item.video.Id, []);

  // Same mapping the cards render with (square no-art fallback) — see itemSlotShape.
  const slotShapeFor = useCallback((item: ResumeItem): ArtworkSlotShape => itemSlotShape(item.video.PrimaryImageAspectRatio), []);

  if (!hasItems) {
    return null;
  }

  return <MediaShelf title="Continue" data={items} slotShapeFor={slotShapeFor} renderItem={renderItem} keyExtractor={keyExtractor} />;
}
