import { LivePreviewSlot } from "@/components/live-tv/live-preview-slot";
import { CARD_CHROME, DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { t } from "@/services/i18n";
import type { JellyfinItem } from "@/types/jellyfin";
import { previewBlockTop, type PreviewBlockGeometry } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { type SharedValue, useAnimatedReaction, useAnimatedStyle } from "react-native-reanimated";

const TAB_RADIUS = 8;
const CLOSE_HIT_SLOP = { top: 10, bottom: 6, left: 10, right: 10 };

interface GuidePreviewBlockProps {
  channel: JellyfinItem;
  /** 0 the channel's card, 1 the open player. */
  open: SharedValue<number>;
  /** The rows list's offset. */
  scrollY: SharedValue<number>;
  /** The row's top in the lists' content. */
  rowTop: number;
  rowHeight: number;
  geometry: PreviewBlockGeometry;
  tabHeight: number;
  /** The channel column's live width: the card the player grows out of. */
  columnW: SharedValue<number>;
  /** The band's height the block may sit in, above the tab bar. */
  bandHeight: number;
  /** The band the block is laid out in, measured for the player's place in the window. */
  bandRef: React.RefObject<View | null>;
  /** The grow has finished: the player takes its frame. */
  settled: boolean;
  onClose: () => void;
}

/**
 * The opened channel row over the guide's band: a close tab on the player's top-left edge, the player's shape
 * grown out of the channel's card, held at the band's edges as its row scrolls away. PlayerHost draws the
 * player over the shape and follows the block through `inlineOffsetY`.
 */
export function GuidePreviewBlock({ channel, open, scrollY, rowTop, rowHeight, geometry, tabHeight, columnW, bandHeight, bandRef, settled, onClose }: GuidePreviewBlockProps) {
  const { setInlineFrame, inlineOffsetY } = usePlayerSession();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const { extra, playerLeft, playerWidth, playerHeight } = geometry;

  useEffect(() => {
    if (!settled) {
      setInlineFrame(null);
      return;
    }
    bandRef.current?.measureInWindow((x, y) => setInlineFrame(playerWidth > 0 ? { x: x + playerLeft, y: y + tabHeight, width: playerWidth, height: playerHeight } : null));
  }, [settled, bandRef, setInlineFrame, playerLeft, playerWidth, playerHeight, tabHeight, windowWidth, windowHeight]);
  useEffect(
    () => () => {
      setInlineFrame(null);
      inlineOffsetY.set(0);
    },
    [setInlineFrame, inlineOffsetY],
  );

  useAnimatedReaction(
    () => previewBlockTop(rowTop, scrollY.get(), bandHeight, rowHeight + open.get() * extra),
    (top) => inlineOffsetY.set(top),
    [rowTop, bandHeight, rowHeight, extra],
  );

  const layerStyle = useAnimatedStyle(() => {
    const height = rowHeight + open.get() * extra;
    return { top: previewBlockTop(rowTop, scrollY.get(), bandHeight, height), height };
  });
  const backdropStyle = useAnimatedStyle(() => ({ opacity: open.get() }));
  const shapeStyle = useAnimatedStyle(() => {
    const at = open.get();
    const card = columnW.get();
    return {
      left: playerLeft * at,
      top: tabHeight * at,
      width: card + (playerWidth - card) * at,
      height: rowHeight + (playerHeight - rowHeight) * at,
    };
  });
  const tabStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, open.get() - 0.6) / 0.4 }));

  return (
    <Animated.View style={[styles.layer, layerStyle]} testID="guide-preview-block">
      <Animated.View style={[styles.backdrop, backdropStyle]} />
      <Animated.View style={[styles.tab, { left: playerLeft, height: tabHeight }, tabStyle]}>
        <Pressable onPress={onClose} hitSlop={CLOSE_HIT_SLOP} accessibilityRole="button" accessibilityLabel={t("common.close")} style={styles.tabBody} testID="guide-preview-close">
          <Ionicons name="close" size={16} color={COLORS.TEXT_PRIMARY} />
        </Pressable>
        <View style={styles.fillet}>
          <View style={styles.ring} />
        </View>
      </Animated.View>
      <Animated.View style={[styles.shape, shapeStyle]}>
        <LivePreviewSlot channel={channel} />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: "absolute",
    left: 0,
    right: 0,
  },
  backdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: COLORS.BACKGROUND,
  },
  // A folder tab on the player's top edge, flush with its left side.
  tab: {
    position: "absolute",
    top: 0,
    flexDirection: "row",
    alignItems: "flex-end",
  },
  tabBody: {
    height: "100%",
    minWidth: 40,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: CARD_CHROME,
    borderTopLeftRadius: TAB_RADIUS,
    borderTopRightRadius: TAB_RADIUS,
  },
  // The inside curve where the tab's right side meets the player's top edge.
  fillet: {
    width: TAB_RADIUS,
    height: TAB_RADIUS,
    overflow: "hidden",
  },
  ring: {
    position: "absolute",
    top: -2 * TAB_RADIUS,
    left: -TAB_RADIUS,
    width: 4 * TAB_RADIUS,
    height: 4 * TAB_RADIUS,
    borderRadius: 2 * TAB_RADIUS,
    borderWidth: TAB_RADIUS,
    borderColor: CARD_CHROME,
  },
  // Square at the top-left, where the tab sits.
  shape: {
    position: "absolute",
    overflow: "hidden",
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    borderTopLeftRadius: 0,
    borderCurve: "continuous",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
});
