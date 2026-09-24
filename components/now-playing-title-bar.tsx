import { LEVEL_BARS_WIDTH, LevelBars } from "@/components/level-bars";
import { MarqueeText } from "@/components/MarqueeText";
import { DESIGN, GRID } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";
import { t } from "@/services/i18n";
import { JellyfinVideoItem } from "@/types/jellyfin";
import { queueTrackProgress } from "@/utils/resumeProgress";
import React, { useEffect, useState } from "react";
import { Dimensions, Platform, StyleSheet, View } from "react-native";

// The grid card's own title sizes (components/video-grid-item.tsx), so the bar swaps in at the same height.
const IS_TV = Platform.isTV;
const SCREEN = Dimensions.get("screen");
const IS_TABLET = !IS_TV && Math.min(SCREEN.width, SCREEN.height) >= GRID.PHONE_WIDE_MIN_WIDTH;
const TITLE_SIZE = IS_TV ? 22 : IS_TABLET ? 15 : 13;
const BAR_PADDING_V = IS_TV ? 10 : 8;
const BAR_DROP = 2;
const BARS = IS_TV ? 20 : 12;
const BARS_WIDTH = LEVEL_BARS_WIDTH;
const MARK_LEFT = IS_TV ? 20 : 10;

interface NowPlayingTitleBarProps {
  video: JellyfinVideoItem;
  focused: boolean;
  /** "audio": position and play state come from the queue. "video": from the props below. */
  kind: "audio" | "video";
  progressPercent?: number;
  playing?: boolean;
}

/**
 * The card's title bar for the item that is playing: the level bars at its left end, and for
 * a track the gold fill follows the native 1 Hz position. Only this card subscribes for it.
 */
export function NowPlayingTitleBar({ video, focused, kind, progressPercent = 0, playing = false }: NowPlayingTitleBarProps) {
  const [state, setState] = useState<AudioPlayerUIState>(() => audioPlayerManager.getUIState());
  useEffect(() => (kind === "audio" ? audioPlayerManager.subscribe(setState) : undefined), [kind]);

  const fraction = kind === "audio" ? queueTrackProgress(video, state.position) : progressPercent;
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
        <View style={styles.mark} pointerEvents="none">
          <LevelBars size={BARS} playing={isPlaying} />
        </View>
        <MarqueeText active={focused} style={styles.infoTitle}>
          {video.Name || t("common.unknown")}
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
    minWidth: DESIGN.BORDER_RADIUS_CARD + (IS_TV ? 20 : 12),
    backgroundColor: COLORS.ACCENT,
  },
  // Holds the side inset, not the bar: the fill measures this parent's content box, so padding
  // up there stops it short of the card's right edge at 100%. Both sides clear the mark, so the
  // TV title stays centred.
  infoTitleBlend: {
    width: "100%",
    paddingHorizontal: MARK_LEFT + BARS_WIDTH + (IS_TV ? 12 : 6),
    mixBlendMode: "difference",
  },
  // Out of flow at the line's left end, where the grid card's title mark sits.
  mark: {
    position: "absolute",
    left: MARK_LEFT,
    top: 0,
    bottom: 0,
    justifyContent: "center",
  },
  infoTitle: {
    width: "100%",
    color: COLORS.ACCENT,
    fontSize: TITLE_SIZE,
    fontWeight: "700",
    textAlign: IS_TV ? "center" : "left",
  },
});

export default NowPlayingTitleBar;
