import { LevelBars } from "@/components/level-bars";
import { MarqueeText } from "@/components/MarqueeText";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";
import { JELLYFIN_TIME } from "@/services/jellyfinApi";
import { JellyfinVideoItem } from "@/types/jellyfin";
import React, { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";

// Apple TV only: the card that hosts this is the TV card, so every size is the TV one.
const TITLE_SIZE = 22;
const BAR_PADDING_V = 10;
const BAR_DROP = 2;
const BARS = 20;
// The native position observer's interval (AudioQueuePlayer.swift), so the last tick of a
// track lands a second short of its end.
const POSITION_TICK_SECONDS = 1;

interface NowPlayingTitleBarProps {
  video: JellyfinVideoItem;
  focused: boolean;
  /** "audio": position and play state come from the queue. "video": from the props below. */
  kind: "audio" | "video";
  progressPercent?: number;
  playing?: boolean;
}

/** Position of the playing track as a 0 to 1 fraction of its runtime. */
function audioProgress(video: JellyfinVideoItem, state: AudioPlayerUIState): number {
  const durationSeconds = (video.RunTimeTicks ?? 0) / JELLYFIN_TIME.TICKS_PER_SECOND;
  if (durationSeconds <= 0) return 0;
  // Full for the last tick, which is the closest to the end the observer ever reports.
  if (state.position > 0 && durationSeconds - state.position <= POSITION_TICK_SECONDS) return 1;
  return Math.min(Math.max(state.position / durationSeconds, 0), 1);
}

/**
 * The card's title bar for the item that is playing: the level bars at its left end, and for
 * a track the gold fill follows the native 1 Hz position. Only this card subscribes for it.
 */
export function NowPlayingTitleBar({ video, focused, kind, progressPercent = 0, playing = false }: NowPlayingTitleBarProps) {
  const [state, setState] = useState<AudioPlayerUIState>(() => audioPlayerManager.getUIState());
  useEffect(() => (kind === "audio" ? audioPlayerManager.subscribe(setState) : undefined), [kind]);

  const fraction = kind === "audio" ? audioProgress(video, state) : progressPercent;
  const isPlaying = kind === "audio" ? state.playing : playing;
  // Floored at 5% so a track that just started still shows. A video card whose screen passes no
  // position (a library grid, with the player in a PiP window) draws no fill: a floor there is a
  // wrong position, and the bar carries a minWidth that a 0% width would still paint.
  const hasFill = kind === "audio" || fraction > 0;
  const fillPercent = Math.max(Math.round(fraction * 100), 5);

  return (
    <View style={styles.infoOverlay} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {hasFill && <View style={[styles.infoProgressFill, { width: `${fillPercent}%` }]} pointerEvents="none" testID="now-playing-progress" />}
      {/* Bars and title share the difference blend, so both invert to black over the fill. */}
      <View style={styles.infoTitleBlend}>
        <LevelBars size={BARS} playing={isPlaying} />
        <MarqueeText active={focused} style={styles.infoTitle}>
          {video.Name || "Unknown"}
        </MarqueeText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  infoOverlay: {
    position: "absolute",
    bottom: -BAR_DROP,
    left: 0,
    right: 0,
    paddingTop: BAR_PADDING_V,
    paddingBottom: BAR_PADDING_V + BAR_DROP,
    overflow: "hidden",
    justifyContent: "center",
    alignItems: "center",
    borderBottomLeftRadius: DESIGN.BORDER_RADIUS_CARD,
    borderBottomRightRadius: DESIGN.BORDER_RADIUS_CARD,
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  infoProgressFill: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    minWidth: DESIGN.BORDER_RADIUS_CARD + 20,
    backgroundColor: COLORS.ACCENT,
  },
  // Holds the side inset, not the bar: the fill measures this parent's content box, so padding
  // up there stops it short of the card's right edge at 100%.
  infoTitleBlend: {
    width: "100%",
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    mixBlendMode: "difference",
  },
  infoTitle: {
    flex: 1,
    color: COLORS.ACCENT,
    fontSize: TITLE_SIZE,
    fontWeight: "700",
    textAlign: "center",
  },
});

export default NowPlayingTitleBar;
