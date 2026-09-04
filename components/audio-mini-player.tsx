import { DraggableToolbar } from "@/components/draggable-toolbar";
import { LevelBars } from "@/components/level-bars";
import { COLORS } from "@/constants/colors";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";
import { playbackArtworkUri } from "@/services/downloads/localSource";
import { joinMeta } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { usePathname } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Sized to the toolbar's pill: artwork and three transports leave the title a narrow column,
// so it truncates rather than wraps.
const BAR_HEIGHT = 64;
const ART = 40;
/** Apple's minimum target. Three of them are why the pill is as wide as it is. */
const TRANSPORT = 44;
/** Where the bar parks above the safe area: clear of the native tab bar, which it can still
    be dragged over. */
const PARK_CLEARANCE = 58;

/** Routes that own the whole screen and carry their own transport. */
const PLAYBACK_ROUTES = ["/player", "/audio-player"];

/** A press-and-hold has no gesture for VoiceOver, so it gets a named action instead. */
const ARTWORK_ACTIONS = [{ name: "longpress", label: "Stop playback" }] as const;

interface TransportProps {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  size: number;
  disabled?: boolean;
  onPress: () => void;
}

/**
 * No hitSlop: these sit edge to edge, so 8 points of slop each put 16 points of overlap
 * between neighbours, and the later sibling wins a press in the shared strip. That is what
 * turned the right half of Pause into Next. The 44pt box is the target instead.
 */
function Transport({ name, label, size, disabled = false, onPress }: TransportProps) {
  return (
    <Pressable onPress={onPress} disabled={disabled} style={styles.transport} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }}>
      <Ionicons name={name} size={size} color={disabled ? COLORS.TEXT_QUATERNARY : COLORS.TEXT_PRIMARY} />
    </Pressable>
  );
}

/**
 * Which skips can move, read off the native rules: forward moves while a track follows and
 * wraps only when the queue loops; back only leaves the first track, since at index 0 the
 * native skip restarts the track instead (AudioQueuePlayer.skipBackward).
 */
export function transportReach(state: Pick<AudioPlayerUIState, "index" | "queueLength" | "loop">) {
  return {
    canPrevious: state.index > 0,
    canNext: state.loop ? state.queueLength > 1 : state.index < state.queueLength - 1,
  };
}

/**
 * The only in-app way to reach music once the native player is dismissed: dismissal leaves the
 * queue running on purpose (audioPlayerManager.handleDismiss). Mounted at the root, beside PlayerHost.
 */
export function AudioMiniPlayer() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [state, setState] = useState<AudioPlayerUIState>(() => audioPlayerManager.getUIState());
  const [failedArtwork, setFailedArtwork] = useState<string | null>(null);

  useEffect(() => audioPlayerManager.subscribe(setState), []);

  const togglePlay = useCallback(() => void audioPlayerManager.setPlaying(!state.playing), [state.playing]);
  const previous = useCallback(() => void audioPlayerManager.previous(), []);
  const next = useCallback(() => void audioPlayerManager.next(), []);
  const stop = useCallback(() => void audioPlayerManager.stop(), []);
  const reopen = useCallback(() => void audioPlayerManager.present(), []);
  const onArtworkAction = useCallback(
    (event: { nativeEvent: { actionName: string } }) => {
      if (event.nativeEvent.actionName === "longpress") stop();
    },
    [stop],
  );

  // uiVisible covers both the presented native player and the moment before it appears; the
  // route check covers the video player, which stops audio but paints its own canvas first.
  if (Platform.isTV || !state.active || state.uiVisible || PLAYBACK_ROUTES.includes(pathname)) return null;

  const track = state.track;
  const { canPrevious, canNext } = transportReach(state);
  const artwork = track ? playbackArtworkUri(track, 200) : null;
  const showArtwork = artwork !== null && artwork !== failedArtwork;
  const subtitle = track ? joinMeta([track.Artists?.length ? track.Artists.join(", ") : track.AlbumArtist, track.Album]) : "";

  // The bars move only while the queue is actually playing, so the notch reports state as
  // well as presence. It is the only thing on screen once the bar is tucked away.
  return (
    <DraggableToolbar height={BAR_HEIGHT} bounds={{ top: insets.top + 8, bottom: insets.bottom + PARK_CLEARANCE }} collapsedIcon={<LevelBars size={22} playing={state.playing} />}>
      <View style={styles.identity}>
        {/* Stopping lives on the artwork, not on a ✕: a close button that small sat inside the
            tucked-away notch and fired on presses meant to bring the bar back. The placeholder
            is the same target and the same size, so an item with no poster behaves identically. */}
        <Pressable
          onPress={reopen}
          onLongPress={stop}
          accessibilityRole="button"
          accessibilityLabel="Open the player"
          accessibilityHint="Press and hold to stop playback"
          accessibilityActions={ARTWORK_ACTIONS}
          onAccessibilityAction={onArtworkAction}>
          {showArtwork ? (
            <Image source={{ uri: artwork }} style={styles.art} contentFit="cover" transition={120} onError={() => setFailedArtwork(artwork)} />
          ) : (
            <Image source={require("@/assets/brand/layer-front.png")} style={[styles.art, styles.artPlaceholder]} contentFit="cover" transition={0} />
          )}
        </Pressable>
        <Pressable onPress={reopen} style={styles.titles} accessibilityRole="button" accessibilityLabel="Open the player">
          <Text style={styles.title} numberOfLines={1}>
            {track?.Name ?? ""}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </Pressable>
      </View>
      <Transport name="play-skip-back" label="Previous track" size={17} disabled={!canPrevious} onPress={previous} />
      <Transport name={state.playing ? "pause" : "play"} label={state.playing ? "Pause" : "Play"} size={22} onPress={togglePlay} />
      <Transport name="play-skip-forward" label="Next track" size={17} disabled={!canNext} onPress={next} />
    </DraggableToolbar>
  );
}

const styles = StyleSheet.create({
  identity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  art: {
    width: ART,
    height: ART,
    borderRadius: 8,
  },
  // The brand face is transparent, so the card fill behind it is what every other posterless
  // tile shows (PosterMark, VideoGridItem).
  artPlaceholder: {
    backgroundColor: COLORS.SURFACE,
  },
  titles: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 13,
    fontWeight: "600",
  },
  subtitle: {
    color: COLORS.TEXT_BODY,
    fontSize: 11,
  },
  // 44 wide and stretched to the padded content height (52), which is the whole target: the
  // boxes meet without overlapping, so every press lands on exactly one control.
  transport: {
    width: TRANSPORT,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
});

export default AudioMiniPlayer;
