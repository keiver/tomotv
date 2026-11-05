import { CARD_CHROME, CARD_FOCUS, RAISED_EDGE, STAND_HEIGHT } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useLiveClip, useLiveFrame } from "@/hooks/useLiveFrame";
import { t } from "@/services/i18n";
import { posterSource } from "@/services/itemArtwork";
import { LIVE_FRAME_TRANSITION_MS } from "@/services/liveFrames";
import type { JellyfinItem, JellyfinProgram } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { durationLabel, programTimes } from "@/utils/guide";
import { Ionicons } from "@expo/vector-icons";
import { LiveClipView, type MultiviewRect } from "@keiver/tomo-live";
import { Image } from "expo-image";
import React, { memo, useCallback, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, View, type NativeSyntheticEvent } from "react-native";

const IS_TV = Platform.isTV;
/** The channel's name: a thin square label half the height of a card's name tab. */
const LABEL_HEIGHT = STAND_HEIGHT / 2;
const LABEL_TEXT = IS_TV ? 12 : 8;

interface MultiviewTileProps {
  channel: JellyfinItem;
  rect: MultiviewRect;
  /** The tile plays with sound. */
  main: boolean;
  /** The tile's live session, null while it shows its clip or picture. */
  liveUrl: string | null;
  /** False while the screen is covered: the tile lets its player go. */
  visible: boolean;
  /** Full screen: the picture alone, no label and no focus ring. */
  bare?: boolean;
  /** The programme airing, for the label; past its end it is not shown. */
  program?: Pick<JellyfinProgram, "Name" | "StartDate" | "EndDate"> | null;
  nowMs: number;
  hasTVPreferredFocus?: boolean;
  onSelect: (channelId: string) => void;
  /** The tile's player failed, or none was free for its live session. */
  onFailed: (channelId: string) => void;
  onLongPress?: (channelId: string) => void;
}

/** A programme's name and time left while it airs; null outside it. */
export function airingLine(program: Pick<JellyfinProgram, "Name" | "StartDate" | "EndDate"> | null | undefined, nowMs: number): string | null {
  if (!program?.Name) return null;
  const { startMs, endMs } = programTimes(program);
  if (!(startMs <= nowMs && nowMs < endMs)) return null;
  return `${cleanLabel(program.Name)} · ${t("liveTv.timeLeft").replace("{time}", durationLabel(endMs - nowMs))}`;
}

/** One multiview spot: its live session when it has one, else its clip, else its picture, else the channel's logo, under its name and programme. */
function MultiviewTileComponent({ channel, rect, main, liveUrl, visible, bare, program, nowMs, hasTVPreferredFocus, onSelect, onFailed, onLongPress }: MultiviewTileProps) {
  const { accent, ink } = useCardPalette();
  const frame = useLiveFrame(channel.Id);
  const clip = useLiveClip(channel.Id);
  const [focused, setFocused] = useState(false);
  const handlePress = useCallback(() => onSelect(channel.Id), [onSelect, channel.Id]);
  const handleLongPress = useCallback(() => onLongPress?.(channel.Id), [onLongPress, channel.Id]);
  const handleFailed = useCallback(() => onFailed(channel.Id), [onFailed, channel.Id]);
  const live = !!liveUrl;
  const uri = visible ? (liveUrl ?? clip?.uri ?? null) : null;
  // The session its player reported playing; the sound spot shows a spinner until its own session plays.
  const [playingUri, setPlayingUri] = useState<string | null>(null);
  const handlePlaying = useCallback((event: NativeSyntheticEvent<{ playing: boolean }>) => setPlayingUri(event.nativeEvent.playing ? uri : null), [uri]);
  const sounding = main && live && playingUri === uri;
  const airing = airingLine(program, nowMs);
  // Touch screens have no focus: the spot with the sound wears the ring Apple TV gives the focused spot.
  const ringed = (focused || (!IS_TV && main)) && !bare;
  const logo = frame ? undefined : posterSource(channel, 300);
  return (
    <TouchableOpacity
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      activeOpacity={0.95}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole="button"
      accessibilityLabel={[cleanLabel(channel.Name ?? ""), airing].filter(Boolean).join(", ")}
      style={[styles.tile, { left: rect.x, top: rect.y, width: rect.width, height: rect.height }, ringed && [styles.focused, { shadowColor: accent }]]}>
      {frame ? null : logo ? (
        <Image source={logo} style={styles.logo} contentFit="contain" cachePolicy="memory-disk" />
      ) : (
        <View style={[styles.logo, styles.glyph]} pointerEvents="none">
          <Ionicons name="tv-outline" size={IS_TV ? 64 : 28} color={COLORS.TEXT_SECONDARY} />
        </View>
      )}
      {frame ? <Image source={frame} style={StyleSheet.absoluteFill} contentFit="cover" transition={LIVE_FRAME_TRANSITION_MS} cachePolicy="none" /> : null}
      {uri !== null ? <LiveClipView uri={uri} live={live} muted={!main} onFailed={handleFailed} onPlaying={handlePlaying} style={StyleSheet.absoluteFill} /> : null}
      {bare ? null : <View style={[styles.edge, ringed && styles.edgeFocused]} pointerEvents="none" />}
      {ringed ? <View style={[styles.focusRing, { borderColor: accent }]} pointerEvents="none" /> : null}
      {bare ? null : (
        <View style={[styles.label, ringed && { backgroundColor: accent }]} pointerEvents="none">
          {sounding ? (
            <Ionicons name="volume-high" size={LABEL_TEXT} color={ringed ? ink : COLORS.TEXT_PRIMARY} />
          ) : main ? (
            <View style={styles.loading} testID="multiview-tile-loading">
              <ActivityIndicator size="small" color={ringed ? ink : COLORS.TEXT_PRIMARY} style={styles.spinner} />
            </View>
          ) : null}
          <Text style={[styles.labelText, ringed && { color: ink }]} numberOfLines={1}>
            {[cleanLabel(channel.Name ?? ""), main ? airing : null].filter(Boolean).join(" · ")}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export const MultiviewTile = memo(MultiviewTileComponent);

const styles = StyleSheet.create({
  tile: {
    position: "absolute",
    overflow: "hidden",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
  // Over the picture, inside the spot: focus takes no space, so the lines between spots stay 2 pt.
  // The Live TV grid card's lit edge, square; under the focus ring it would read as a second ring.
  edge: {
    ...StyleSheet.absoluteFill,
    boxShadow: RAISED_EDGE,
  },
  edgeFocused: {
    boxShadow: "none",
  },
  label: {
    position: "absolute",
    top: 0,
    left: 0,
    maxWidth: "100%",
    height: LABEL_HEIGHT,
    paddingHorizontal: IS_TV ? 6 : 4,
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 4 : 2,
    backgroundColor: CARD_CHROME,
  },
  // The speaker icon's slot; the spinner is drawn small inside it, as on the card badge.
  loading: {
    width: LABEL_TEXT,
    height: LABEL_TEXT,
    alignItems: "center",
    justifyContent: "center",
  },
  spinner: {
    transform: [{ scale: IS_TV ? 0.45 : 0.3 }],
  },
  labelText: {
    flexShrink: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: LABEL_TEXT,
    fontWeight: "600",
  },
  focusRing: {
    ...StyleSheet.absoluteFill,
    borderWidth: CARD_FOCUS.BORDER_WIDTH_FOCUSED,
  },
  focused: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: CARD_FOCUS.GLOW_OPACITY,
    shadowRadius: IS_TV ? CARD_FOCUS.GLOW_RADIUS.tv : CARD_FOCUS.GLOW_RADIUS.phone,
  },
  logo: {
    position: "absolute",
    left: "25%",
    right: "25%",
    top: "20%",
    bottom: "35%",
  },
  glyph: {
    alignItems: "center",
    justifyContent: "center",
  },
});
