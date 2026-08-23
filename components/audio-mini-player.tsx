import { DraggableToolbar } from "@/components/draggable-toolbar";
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

const BAR_HEIGHT = 60;
const ART = 44;
/** Where the bar parks: clear of the native tab bar, which it can be dragged over anyway. */
const PARK_CLEARANCE = 62;
/** Quiet time before the bar tucks itself against an edge. */
const IDLE_COLLAPSE_MS = 5000;

/** Routes that own the whole screen and carry their own transport. */
const PLAYBACK_ROUTES = ["/player", "/audio-player"];

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

  // uiVisible covers both the presented native player and the moment before it appears; the
  // route check covers the video player, which stops audio but paints its own canvas first.
  if (Platform.isTV || !state.active || state.uiVisible || PLAYBACK_ROUTES.includes(pathname)) return null;

  const track = state.track;
  const artwork = track && hasPoster(track) ? getPosterUrl(track.Id, 200) : null;
  const subtitle = track ? joinMeta([track.Artists?.length ? track.Artists.join(", ") : track.AlbumArtist, track.Album]) : "";

  return (
    <DraggableToolbar height={BAR_HEIGHT} bounds={{ top: insets.top + 8, bottom: insets.bottom + PARK_CLEARANCE }} idleCollapseMs={IDLE_COLLAPSE_MS}>
      <Pressable onPress={reopen} style={styles.identity} accessibilityRole="button" accessibilityLabel="Open the player">
        {artwork ? <Image source={{ uri: artwork }} style={styles.art} contentFit="cover" transition={120} /> : <View style={[styles.art, styles.artPlaceholder]} />}
        <View style={styles.titles}>
          <Text style={styles.title} numberOfLines={1}>
            {track?.Name ?? ""}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Transport name="play-skip-back" label="Previous track" size={20} onPress={previous} />
      <Transport name={state.playing ? "pause" : "play"} label={state.playing ? "Pause" : "Play"} size={26} onPress={togglePlay} />
      <Transport name="play-skip-forward" label="Next track" size={20} onPress={next} />
      <Transport name="close" label="Stop playback" size={20} onPress={stop} />
    </DraggableToolbar>
  );
}

const styles = StyleSheet.create({
  identity: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
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
    fontSize: 14,
    fontWeight: "600",
  },
  subtitle: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: 12,
    marginTop: 1,
  },
  transport: {
    width: 34,
    height: BAR_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
  },
});

export default AudioMiniPlayer;
