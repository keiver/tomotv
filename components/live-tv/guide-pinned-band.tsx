import { CloseOverlayButton } from "@/components/close-overlay-button";
import { GlassIconButton } from "@/components/glass-icon-button";
import { GuideChannelCard } from "@/components/live-tv/guide-channel-card";
import { GuideChannelTile } from "@/components/live-tv/guide-channel-tile";
import { COLORS } from "@/constants/colors";
import { GuidePinnedTab, PINNED_EDGE } from "@/components/live-tv/guide-pinned-tab";
import { GuidePinnedOverlay, PINNED_TEXT_INSET } from "@/components/live-tv/guide-pinned-overlay";
import { pinnedButtonGlow } from "@/components/live-tv/pinned-corner-buttons";
import { usePlayerSession, type InlineFrame } from "@/contexts/PlayerSessionContext";
import { useCardPalette } from "@/hooks/useCardPalette";
import { usePinnedRecordButton } from "@/hooks/usePinnedRecordButton";
import { tapFeedback } from "@/services/haptics";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { bandExtendedSize, bandSwipeToggles, formatClockRange, type GuideMetrics } from "@/utils/guide";
import { THIS_DEVICE } from "@/utils/hostEnvironment";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, type LayoutChangeEvent, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import Animated, { LinearTransition, runOnJS, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const OPENING_DIM = 0.3;
/** The band's swipe reaches this far below its edge. */
const EDGE_SLOP = 20;
const SIDE_BUTTON = 38;
const SIDE_ICON = 19; /** iPhone's larger picture takes the screen's width, so its name and buttons move onto the picture. */
const ON_PICTURE = THIS_DEVICE === "iPhone";
const SIZE_MS = 260;
/** The picture's height from which the programme beside it gets a second line under the buttons. */
const TWO_LINE_HEIGHT = 130;

interface GuidePinnedBandProps {
  channel: JellyfinItem;
  /** What the channel airs now, when the guide has it. */
  program?: JellyfinProgram;
  /** The column's committed metrics: the card's width and the row's height at the current stop. */
  metrics: GuideMetrics;
  /** The closed stop: the band holds the logo tile and the player parks, still playing. */
  compact: boolean;
  /** Too little room beside the player to name the channel: only the buttons stay. */
  bare: boolean;
  /** The column's live width: the slot crops to it while it is dragged. */
  columnWidth: SharedValue<number>;
  /** The cards' growth while the column is dragged wider, the band's card's too. */
  cardScale: SharedValue<number>;
  /** The column is being dragged: the player parks, still playing, until the band is measured at the new width. */
  resizing: boolean;
  /** The channel is still opening: its own clip shows in the slot, dimmed under the spinner, until the player takes it. */
  opening: boolean;
  /** The band plays the channel's recording in progress, not the channel. */
  playsRecording: boolean;
  /** The guide's clock. */
  nowMs: number;
  /** Where the player draws, in window coordinates; null parks it. */
  onSlot: (frame: InlineFrame | null) => void;
  /** A tap on the player or its card: the presented player, with AVKit's controls. */
  onOpen: () => void;
  onClose: () => void;
  /** The record button is about to start a recording on the channel. */
  onRecordStart: () => void;
  /** The record write answered, whether it landed. */
  onRecordSettled: (landed: boolean) => void;
  /** The band's laid-out height, bottom edge included. */
  onHeight: (height: number) => void;
}

/**
 * Live TV's pinned channel, above the guide's two lists: the player's picture in the card's slot, the channel and what
 * it airs, a button between the card's size and a larger picture, and a close button. Outside both lists, so scrolling
 * never moves the player. Phone, iPad and Mac.
 */
export function GuidePinnedBand({
  channel,
  program,
  metrics,
  compact,
  bare,
  columnWidth,
  cardScale,
  resizing,
  opening,
  playsRecording,
  nowMs,
  onSlot,
  onOpen,
  onClose,
  onRecordStart,
  onRecordSettled,
  onHeight,
}: GuidePinnedBandProps) {
  const { accent } = useCardPalette();
  const { setInlineOverlay, setInlineMuted } = usePlayerSession();
  const insets = useSafeAreaInsets();
  const { height: windowH } = useWindowDimensions();
  const [bandW, setBandW] = useState(0);
  // Kept across channel switches: the band stays mounted while the pin moves.
  const [extended, setExtended] = useState(false);
  // From the size button's press until the band has animated to its new size: the player parks, still playing.
  const [sizing, setSizing] = useState(false);
  // Kept across channel switches, like the size.
  const [muted, setMuted] = useState(false);
  const toggleMute = useCallback(() => {
    void tapFeedback();
    setMuted((was) => !was);
  }, []);
  useEffect(() => setInlineMuted(muted), [muted, setInlineMuted]);
  useEffect(() => () => setInlineMuted(false), [setInlineMuted]);

  const rowVideoH = metrics.rowHeight - 1;
  const large = bandExtendedSize(Math.max(0, bandW - insets.right), windowH, !ON_PICTURE);
  const showTile = compact && !extended;
  const videoW = extended ? large.width : compact ? metrics.compactColumnWidth : metrics.channelColumnWidth;
  const videoH = extended ? large.height : rowVideoH;
  const onPicture = extended && ON_PICTURE;

  const slotRef = useRef<View>(null);
  const measure = useCallback(() => {
    if (showTile || resizing || sizing) {
      onSlot(null);
      return;
    }
    slotRef.current?.measureInWindow((x, y, width, height) => onSlot(width > 0 && height > 0 ? { x, y, width, height } : null));
  }, [showTile, resizing, sizing, onSlot]);
  useEffect(() => {
    measure();
  }, [measure, videoW, videoH]);
  const handleBandLayout = useCallback(
    (event: LayoutChangeEvent) => {
      setBandW(event.nativeEvent.layout.width);
      onHeight(event.nativeEvent.layout.height);
      measure();
    },
    [measure, onHeight],
  );

  useEffect(() => {
    if (!sizing) return;
    const timer = setTimeout(() => setSizing(false), SIZE_MS);
    return () => clearTimeout(timer);
  }, [sizing]);
  const sizeTransition = sizing ? LinearTransition.duration(SIZE_MS) : undefined;
  const toggleSize = useCallback(() => {
    void tapFeedback();
    setSizing(true);
    setExtended((was) => !was);
  }, []);

  // Down opens the larger picture, up closes it; one gesture per view it is attached to.
  const swipe = useCallback(
    () =>
      Gesture.Pan()
        .activeOffsetY([-12, 12])
        .failOffsetX([-20, 20])
        .onEnd((event, success) => {
          "worklet";
          if (success && bandSwipeToggles(event.translationY, event.velocityY, extended)) runOnJS(toggleSize)();
        }),
    [extended, toggleSize],
  );
  const bandSwipe = useMemo(() => swipe(), [swipe]);
  const overlaySwipe = useMemo(() => swipe(), [swipe]);
  const tabSwipe = useMemo(() => swipe(), [swipe]);

  const name = cleanLabel(channel.Name);
  const startMs = Date.parse(program?.StartDate ?? "");
  const endMs = Date.parse(program?.EndDate ?? "");
  const { recordButton, mark } = usePinnedRecordButton({ channel, program, nowMs, playsRecording, onRecordStart, onRecordSettled });

  const overlay = showTile ? null : (
    <GuidePinnedOverlay
      name={name}
      mark={mark}
      record={recordButton}
      extended={extended}
      bar={onPicture}
      accent={accent}
      muted={muted}
      onToggleMute={toggleMute}
      onToggleSize={toggleSize}
      onOpen={onOpen}
      onClose={onClose}
    />
  );
  // The player draws above the guide, so the copy over the playing picture is the host's, and it takes the swipe there.
  const hostOverlay = useMemo(
    () =>
      showTile ? null : (
        <GuidePinnedOverlay
          name={name}
          mark={mark}
          record={recordButton}
          extended={extended}
          bar={onPicture}
          accent={accent}
          swipe={overlaySwipe}
          muted={muted}
          onToggleMute={toggleMute}
          onToggleSize={toggleSize}
          onOpen={onOpen}
          onClose={onClose}
        />
      ),
    [showTile, name, mark, recordButton, extended, onPicture, accent, overlaySwipe, muted, toggleMute, toggleSize, onOpen, onClose],
  );
  useEffect(() => setInlineOverlay(hostOverlay), [hostOverlay, setInlineOverlay]);
  useEffect(() => () => setInlineOverlay(null), [setInlineOverlay]);

  const cropStyle = useAnimatedStyle(() => {
    if (extended || showTile) return { width: videoW };
    return { width: Math.min(columnWidth.get(), Math.max(videoW * cardScale.get(), videoW)) };
  });
  const growStyle = useAnimatedStyle(() => ({ transform: [{ scale: extended ? 1 : cardScale.get() }] }));

  const slot = Number.isFinite(startMs) && Number.isFinite(endMs) ? formatClockRange(startMs, endMs) : null;

  const info = (
    <View style={styles.info} pointerEvents="none">
      <Text style={styles.channelName} numberOfLines={1}>
        {name}
      </Text>
      {program ? (
        <Text style={styles.program} numberOfLines={videoH < TWO_LINE_HEIGHT ? 1 : 2}>
          {cleanLabel(program.Name)}
          {slot ? <Text style={styles.slot}>{`  ${slot.start} – ${slot.end}`}</Text> : null}
        </Text>
      ) : null}
    </View>
  );
  const buttons = (
    <View style={[styles.buttons, pinnedButtonGlow(accent)]}>
      <GlassIconButton
        icon={muted ? "volume-mute-outline" : "volume-high-outline"}
        iconSize={SIDE_ICON}
        size={SIDE_BUTTON}
        color={accent}
        onPress={toggleMute}
        accessibilityLabel={t(muted ? "liveTv.unmute" : "liveTv.mute")}
      />
      {recordButton ? (
        <View testID="guide-pinned-record">
          <GlassIconButton
            icon={recordButton.icon}
            iconSize={SIDE_ICON}
            size={SIDE_BUTTON}
            color={COLORS.DESTRUCTIVE}
            label={ON_PICTURE ? undefined : recordButton.text}
            onPress={recordButton.onPress}
            accessibilityLabel={recordButton.label}
          />
        </View>
      ) : null}
      <GlassIconButton
        icon={extended ? "contract-outline" : "expand-outline"}
        iconSize={SIDE_ICON}
        size={SIDE_BUTTON}
        color={accent}
        onPress={toggleSize}
        accessibilityLabel={t(extended ? "liveTv.smallerPicture" : "liveTv.largerPicture")}
      />
      <View testID="guide-pinned-close">
        <CloseOverlayButton onPress={onClose} size={SIDE_BUTTON} color={accent} />
      </View>
    </View>
  );

  return (
    // The band's own layout too: a rotation moves the slot in the window without changing the slot's size.
    <Animated.View style={styles.lift} layout={sizeTransition} onLayout={handleBandLayout} testID="guide-pinned-band">
      <GestureHandlerRootView style={styles.swipeRoot}>
        <GestureDetector gesture={bandSwipe}>
          <Animated.View style={[styles.band, { borderBottomColor: accent, paddingRight: insets.right }]} hitSlop={{ bottom: EDGE_SLOP }} layout={sizeTransition}>
            <View style={styles.row}>
              <Animated.View style={[styles.crop, { height: videoH }, cropStyle]}>
                <Animated.View ref={slotRef} style={[styles.grow, { width: videoW, height: videoH }, growStyle]} onLayout={measure} collapsable={false}>
                  <View style={[opening ? styles.dimmed : styles.fill, showTile && styles.tileSeat]}>
                    {showTile ? (
                      <GuideChannelTile channel={channel} metrics={metrics} onPress={onOpen} />
                    ) : (
                      <GuideChannelCard channel={channel} index={0} cardWidth={videoW} hideAiring flat square inset={metrics.cardInset} onPress={onOpen} playsClipInView inView />
                    )}
                  </View>
                </Animated.View>
                {opening ? (
                  <View style={styles.opening} pointerEvents="none" accessible accessibilityLabel={t("liveTv.tuningIn")} testID="guide-pinned-opening">
                    <ActivityIndicator size="small" color={accent} />
                  </View>
                ) : null}
                {overlay}
              </Animated.View>
              {onPicture ? null : (
                <View style={styles.side}>
                  {buttons}
                  {bare ? null : info}
                </View>
              )}
            </View>
          </Animated.View>
        </GestureDetector>
      </GestureHandlerRootView>
      <GuidePinnedTab left={PINNED_TEXT_INSET} extended={extended} swipe={tabSwipe} onToggle={toggleSize} name={name} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  // Sized by the band: the root view's default style is flex 1, which collapses it in this content-sized column.
  swipeRoot: {
    alignSelf: "stretch",
  },
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
    borderBottomWidth: PINNED_EDGE,
    backgroundColor: COLORS.BACKGROUND,
  },
  row: {
    flexDirection: "row",
  },
  // Beside the picture: the buttons along the top, close in the corner, and the text along the bottom at full width.
  side: {
    flex: 1,
    justifyContent: "space-between",
    paddingVertical: 8,
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
  info: {
    flex: 1,
    justifyContent: "flex-end",
    paddingHorizontal: PINNED_TEXT_INSET,
    gap: 2,
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
  buttons: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 12,
    marginHorizontal: 12,
  },
});
