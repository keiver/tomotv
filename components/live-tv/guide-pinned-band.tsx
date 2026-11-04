import { CloseOverlayButton } from "@/components/close-overlay-button";
import { GuideChannelCard } from "@/components/live-tv/guide-channel-card";
import { GuideChannelTile } from "@/components/live-tv/guide-channel-tile";
import { GRID } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { usePlayerSession, type InlineFrame } from "@/contexts/PlayerSessionContext";
import { useCardPalette } from "@/hooks/useCardPalette";
import { selectionFeedback } from "@/services/haptics";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { bandVideoStops, formatClockRange, type GuideMetrics, nearestStop, settleStop, stopDragValue } from "@/utils/guide";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { Extrapolation, interpolate, runOnJS, type SharedValue, useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, withSpring } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const OPENING_DIM = 0.3;
/** The band's bottom edge, in the theme's accent and heavier than the rows' grid line below it. */
const BAND_EDGE = 3;
/** The close button's strip right of the video: the player draws over the app, so nothing can sit on the picture itself. */
const CLOSE_STRIP = 56;
const EDGE_HIT = 24;
const STOP_SPRING = { damping: 32, stiffness: 260, mass: 1, overshootClamping: true };
const SIZE_LABEL: Parameters<typeof t>[0][] = ["liveTv.pinnedSmall", "liveTv.pinnedMedium", "liveTv.pinnedLarge"];
const STEP_ACTIONS = [{ name: "increment" }, { name: "decrement" }];

interface GuidePinnedBandProps {
  channel: JellyfinItem;
  /** What the channel airs now, when the guide has it. */
  program?: JellyfinProgram;
  /** The column's committed metrics: the card's width and the row's height at the current stop. */
  metrics: GuideMetrics;
  /** The closed stop: the band holds the logo tile and the player parks, still playing. */
  compact: boolean;
  /** Too little room beside the player to name the channel: only the close button stays. */
  bare: boolean;
  /** The column's live width: the slot crops to it while it is dragged. */
  columnWidth: SharedValue<number>;
  /** The cards' growth while the column is dragged wider, the band's card's too. */
  cardScale: SharedValue<number>;
  /** The column is being dragged: the player parks, still playing, until the band is measured at the new width. */
  resizing: boolean;
  /** The channel is still opening: its own clip shows in the slot, dimmed under the spinner, until the player takes it. */
  opening: boolean;
  /** Where the player draws, in window coordinates; null parks it. */
  onSlot: (frame: InlineFrame | null) => void;
  /** A tap on the player or its card: the presented player, with AVKit's controls. */
  onOpen: () => void;
  onClose: () => void;
}

/**
 * Live TV's pinned channel, above the guide's two lists: the player's picture in the card's slot, the channel and what
 * it airs beside it, and a close button. Its bottom edge drags the picture taller, up to the guide's width, the channel's
 * name fading out as it grows. Outside both lists, so scrolling never moves the player. Phone only.
 */
export function GuidePinnedBand({ channel, program, metrics, compact, bare, columnWidth, cardScale, resizing, opening, onSlot, onOpen, onClose }: GuidePinnedBandProps) {
  const { accent } = useCardPalette();
  const { inlineScale } = usePlayerSession();
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const [bandW, setBandW] = useState(0);
  const rowVideoH = metrics.rowHeight - 1;
  const stops = useMemo(() => bandVideoStops(rowVideoH, Math.max(0, bandW - insets.right - CLOSE_STRIP), windowH), [rowVideoH, bandW, insets.right, windowH]);
  const [stopIndex, setStopIndex] = useState(0);
  const grown = stopIndex > 0;
  const videoH = stops[stopIndex];
  const showTile = compact && !grown;
  const cardWidth = grown ? videoH * GRID.LIVE_RATIO : compact ? metrics.compactColumnWidth : metrics.channelColumnWidth;

  // The picture's live height during an edge drag, and the height the band is laid out at.
  const liveH = useSharedValue(videoH);
  const committedH = useSharedValue(videoH);
  useEffect(() => {
    liveH.set(videoH);
    committedH.set(videoH);
  }, [videoH, liveH, committedH]);
  const growing = useDerivedValue(() => liveH.get() / committedH.get());
  useAnimatedReaction(
    () => growing.get(),
    (scale) => inlineScale.set(scale),
  );
  useEffect(() => () => inlineScale.set(1), [inlineScale]);

  const slotRef = useRef<View>(null);
  const measure = useCallback(() => {
    if (showTile || resizing) {
      onSlot(null);
      return;
    }
    slotRef.current?.measureInWindow((x, y, width, height) => onSlot(width > 0 && height > 0 ? { x, y, width, height } : null));
  }, [showTile, resizing, onSlot]);
  useEffect(() => {
    measure();
  }, [measure, cardWidth, videoH]);
  const handleBandLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setBandW(event.nativeEvent.layout.width);
      measure();
    },
    [measure],
  );

  const tick = useCallback(() => void selectionFeedback(), []);
  const start = useSharedValue(0);
  const passing = useSharedValue(0);
  const edgePan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!showTile)
        .activeOffsetY([-8, 8])
        .failOffsetX([-20, 20])
        .onBegin(() => {
          "worklet";
          start.set(liveH.get());
          passing.set(nearestStop(liveH.get(), stops));
        })
        .onUpdate((event) => {
          "worklet";
          const height = stopDragValue(start.get(), event.translationY, stops);
          liveH.set(height);
          const near = nearestStop(height, stops);
          if (near !== passing.get()) {
            passing.set(near);
            runOnJS(tick)();
          }
        })
        .onFinalize((event) => {
          "worklet";
          const index = settleStop(liveH.get(), event.velocityY, start.get(), stops);
          const height = stops[index];
          liveH.set(
            withSpring(height, { ...STOP_SPRING, velocity: event.velocityY }, (finished) => {
              "worklet";
              if (finished) runOnJS(setStopIndex)(index);
            }),
          );
        }),
    [showTile, stops, start, passing, liveH, tick],
  );
  const stepSize = useCallback((direction: 1 | -1) => setStopIndex((index) => Math.min(stops.length - 1, Math.max(0, index + direction))), [stops.length]);

  const bandStyle = useAnimatedStyle(() => ({ height: liveH.get() + BAND_EDGE }));
  const edgeStyle = useAnimatedStyle(() => ({ top: liveH.get() + BAND_EDGE - EDGE_HIT / 2 }));
  const cropStyle = useAnimatedStyle(() => {
    const scale = growing.get();
    if (showTile) return { width: cardWidth, height: rowVideoH };
    const base = grown ? cardWidth : Math.min(columnWidth.get(), Math.max(cardWidth * cardScale.get(), cardWidth));
    return { width: base * scale, height: (grown ? videoH : rowVideoH) * scale };
  });
  const growStyle = useAnimatedStyle(() => ({ transform: [{ scale: growing.get() * (grown ? 1 : cardScale.get()) }] }));
  const infoStyle = useAnimatedStyle(() => {
    const fade = interpolate(liveH.get(), [stops[0], stops[1]], [0, 1], Extrapolation.CLAMP);
    return { opacity: 1 - fade, transform: [{ translateX: 24 * fade }] };
  });

  const startMs = Date.parse(program?.StartDate ?? "");
  const endMs = Date.parse(program?.EndDate ?? "");
  const slot = Number.isFinite(startMs) && Number.isFinite(endMs) ? formatClockRange(startMs, endMs) : null;

  return (
    // The band's own layout too: a rotation moves the slot in the window without changing the slot's size.
    <View style={[styles.lift, { height: videoH + BAND_EDGE }]} onLayout={handleBandLayout} testID="guide-pinned-band">
      {/* An edge drag grows this over the lists below; the band's laid-out height follows once the picture rests. */}
      <Animated.View style={[styles.band, styles.inner, { borderBottomColor: accent, paddingRight: insets.right }, bandStyle]}>
        <Animated.View style={[styles.crop, cropStyle]}>
          <Animated.View ref={slotRef} style={[styles.grow, { width: cardWidth, height: grown ? videoH : rowVideoH }, growStyle]} onLayout={measure} collapsable={false}>
            <View style={[opening ? styles.dimmed : styles.fill, showTile && styles.tileSeat]}>
              {showTile ? (
                <GuideChannelTile channel={channel} metrics={metrics} onPress={onOpen} />
              ) : (
                <GuideChannelCard channel={channel} index={0} cardWidth={cardWidth} hideAiring flat square inset={metrics.cardInset} onPress={onOpen} playsClipInView inView />
              )}
            </View>
          </Animated.View>
          {opening ? (
            <View style={styles.opening} pointerEvents="none" accessible accessibilityLabel={t("liveTv.tuningIn")} testID="guide-pinned-opening">
              <ActivityIndicator size="small" color={accent} />
            </View>
          ) : null}
        </Animated.View>
        {bare ? (
          <View style={styles.spacer} />
        ) : (
          <Animated.View style={[styles.info, infoStyle]} pointerEvents="none">
            <Text style={styles.channelName} numberOfLines={1}>
              {cleanLabel(channel.Name)}
            </Text>
            {program ? (
              <Text style={styles.program} numberOfLines={2}>
                {cleanLabel(program.Name)}
                {slot ? <Text style={styles.slot}>{`  ${slot.start} – ${slot.end}`}</Text> : null}
              </Text>
            ) : null}
          </Animated.View>
        )}
        <View style={styles.close} testID="guide-pinned-close">
          <CloseOverlayButton onPress={onClose} compact />
        </View>
      </Animated.View>
      {/* Straddles the bottom edge, its grip below it, where the player cannot cover it. */}
      <Animated.View style={[styles.edge, edgeStyle]} pointerEvents="box-none">
        <GestureHandlerRootView style={styles.fill}>
          <GestureDetector gesture={edgePan}>
            <View
              style={styles.edgeHit}
              accessible
              accessibilityRole="adjustable"
              accessibilityLabel={t("liveTv.pinnedSize")}
              accessibilityValue={{ text: t(SIZE_LABEL[stopIndex]) }}
              accessibilityActions={STEP_ACTIONS}
              onAccessibilityAction={(event) => stepSize(event.nativeEvent.actionName === "increment" ? 1 : -1)}
              testID="guide-pinned-edge">
              <View style={[styles.edgePill, { backgroundColor: accent }]} />
            </View>
          </GestureDetector>
        </GestureHandlerRootView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the lists it lies over, casting its shadow down onto them; unclipped, so the shadow shows.
  lift: {
    zIndex: 1,
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.6,
    shadowRadius: 18,
    // An opaque shadow caster: the shadow's shape is the band's box, not a pass over every view inside it.
    backgroundColor: COLORS.BACKGROUND,
  },
  band: {
    overflow: "hidden",
    borderBottomWidth: BAND_EDGE,
    backgroundColor: COLORS.BACKGROUND,
  },
  inner: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  // The slot follows the column's width while it is dragged, cropping the card it grows.
  crop: {
    overflow: "hidden",
  },
  grow: {
    transformOrigin: "left top",
  },
  fill: {
    flex: 1,
  },
  // Flush with the column's right edge, as the list's logo tiles sit.
  tileSeat: {
    alignItems: "flex-end",
  },
  // The channel's own picture or logo, dimmed so the spinner over it reads.
  dimmed: {
    flex: 1,
    opacity: OPENING_DIM,
  },
  opening: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  spacer: {
    flex: 1,
  },
  info: {
    flex: 1,
    alignSelf: "center",
    paddingHorizontal: 12,
    gap: 4,
  },
  channelName: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 17,
    fontWeight: "600",
  },
  program: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 14,
  },
  slot: {
    color: COLORS.TEXT_SECONDARY,
  },
  close: {
    alignSelf: "center",
    marginHorizontal: 12,
  },
  // The bottom edge's drag handle, the band's full width; half of it reaches over the lists below.
  edge: {
    position: "absolute",
    left: 0,
    right: 0,
    height: EDGE_HIT,
  },
  edgeHit: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-end",
    paddingBottom: 3,
  },
  edgePill: {
    width: 28,
    height: 5,
    borderRadius: 2.5,
  },
});
