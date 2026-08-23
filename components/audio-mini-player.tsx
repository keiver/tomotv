import { DraggableToolbar } from "@/components/draggable-toolbar";
import { SpinningDisc } from "@/components/spinning-disc";
import { COLORS } from "@/constants/colors";
import { audioPlayerManager, type AudioPlayerUIState } from "@/services/audioPlayerManager";
import { getPosterUrl, hasPoster } from "@/services/jellyfinApi";
import { joinMeta } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { usePathname } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// Sized to the toolbar's 240pt pill: artwork, three transports and two grips leave the title
// a narrow column, so it truncates rather than wraps.
const BAR_HEIGHT = 64;
const ART = 40;
/** Where the bar parks above the safe area: clear of the native tab bar, which it can still
    be dragged over. */
const PARK_CLEARANCE = 58;
/** Quiet time before the bar tucks itself against an edge. */
const IDLE_COLLAPSE_MS = 5000;

/** Routes that own the whole screen and carry their own transport. */
const PLAYBACK_ROUTES = ["/player", "/audio-player"];

/** A press-and-hold has no gesture for VoiceOver, so it gets a named action instead. */
const ARTWORK_ACTIONS = [{ name: "longpress", label: "Stop playback" }] as const;

interface TransportProps {
  name: keyof typeof Ionicons.glyphMap;
  label: string;
  size: number;
  onPress: () => void;
}

function Transport({ name, label, size, onPress }: TransportProps) {
  return (
    <Pressable onPress={onPress} style={styles.transport} hitSlop={8} accessibilityRole="button" accessibilityLabel={label}>
      <Ionicons name={name} size={size} color={COLORS.TEXT_PRIMARY} />
    </Pressable>
  );
}

/**
 * The only in-app way to reach music once the native player has been dismissed.
 *
 * Dismissing that player leaves the queue running on purpose (audioPlayerManager.handleDismiss),
 * which until now left no control anywhere in the app. Mounted at the root, beside PlayerHost.
 */
export function AudioMiniPlayer() {
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [state, setState] = useState<AudioPlayerUIState>(() => audioPlayerManager.getUIState());

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
  const artwork = track && hasPoster(track) ? getPosterUrl(track.Id, 200) : null;
  const subtitle = track ? joinMeta([track.Artists?.length ? track.Artists.join(", ") : track.AlbumArtist, track.Album]) : "";

  // The disc turns only while the queue is actually playing, so the notch reports state as
  // well as presence. It is the only thing on screen once the bar is tucked away.
  return (
    <DraggableToolbar
      height={BAR_HEIGHT}
      bounds={{ top: insets.top + 8, bottom: insets.bottom + PARK_CLEARANCE, left: insets.left, right: insets.right }}
      collapsedIcon={<SpinningDisc size={19} spinning={state.playing} />}
      idleCollapseMs={IDLE_COLLAPSE_MS}>
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
          {artwork ? <Image source={{ uri: artwork }} style={styles.art} contentFit="cover" transition={120} /> : <View style={[styles.art, styles.artPlaceholder]} />}
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
      <Transport name="play-skip-back" label="Previous track" size={17} onPress={previous} />
      <Transport name={state.playing ? "pause" : "play"} label={state.playing ? "Pause" : "Play"} size={22} onPress={togglePlay} />
      <Transport name="play-skip-forward" label="Next track" size={17} onPress={next} />
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
  artPlaceholder: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
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
  // Stretches to the padded content height rather than the bar's, which would overflow it.
  transport: {
    width: 30,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
});

export default AudioMiniPlayer;
