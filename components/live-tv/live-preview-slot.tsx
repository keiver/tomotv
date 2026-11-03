import { FocusableButton } from "@/components/FocusableButton";
import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { usePlayerSession } from "@/contexts/PlayerSessionContext";
import { useLiveFrame } from "@/hooks/useLiveFrame";
import { useRecordingHoldChoices } from "@/hooks/useRecordingHoldChoices";
import { t } from "@/services/i18n";
import type { JellyfinItem } from "@/types/jellyfin";
import { previewSlotSize } from "@/utils/guide";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, useWindowDimensions, View, type LayoutChangeEvent } from "react-native";

const SIDE_MARGIN = 16;

/**
 * The frame Live TV's channel plays in, above the guide. The player itself is PlayerHost's, drawn over this
 * frame at the rect it reports; underneath, the channel's last frame while it opens, Retry when it failed, and
 * the recording's hold on a one-connection provider with the way to take the connection back.
 */
export function LivePreviewSlot({ channel }: { channel: JellyfinItem }) {
  const { setInlineFrame, hostMode, retry, playbackState, sessionVideoId } = usePlayerSession();
  const router = useRouter();
  const openRecording = useCallback((item: JellyfinItem) => router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name } }), [router]);
  const hold = useRecordingHoldChoices(sessionVideoId ?? channel.Id, playbackState, retry, openRecording);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const [rowWidth, setRowWidth] = useState(0);
  const size = previewSlotSize(Math.max(0, rowWidth - 2 * SIDE_MARGIN), windowHeight);
  const frameRef = useRef<View>(null);
  const liveFrame = useLiveFrame(channel.Id);

  const handleRowLayout = useCallback((event: LayoutChangeEvent) => setRowWidth(event.nativeEvent.layout.width), []);
  const measure = useCallback(() => {
    frameRef.current?.measureInWindow((x, y, width, height) => setInlineFrame(width > 0 && height > 0 ? { x, y, width, height } : null));
  }, [setInlineFrame]);
  // A rotation or a Mac window resize can move the frame without changing its own size.
  useEffect(measure, [measure, windowWidth, windowHeight]);
  useEffect(() => () => setInlineFrame(null), [setInlineFrame]);

  return (
    <View style={[styles.row, { height: size.height }]} onLayout={handleRowLayout}>
      <View ref={frameRef} style={[styles.frame, size]} onLayout={measure}>
        {liveFrame ? <Image source={{ uri: liveFrame.uri }} style={StyleSheet.absoluteFill} contentFit="cover" /> : null}
        {hostMode === "error" && hold.held && !hold.stopping && !hold.opening ? (
          <View style={[styles.center, styles.dim]}>
            <Text style={styles.reasonText}>{hold.reason}</Text>
            {hold.holdingTimer ? (
              <View style={styles.choices}>
                <FocusableButton title={t("liveTv.stopRecordingAndPlay")} variant="retry" onPress={hold.stopAndPlay} style={styles.choice} />
                <FocusableButton title={t("liveTv.watchRecording")} variant="secondary" onPress={hold.watch} style={styles.choice} />
              </View>
            ) : null}
          </View>
        ) : hostMode === "error" && !hold.held ? (
          <View style={[styles.center, styles.dim]}>
            <Text style={styles.errorText}>{t("player.unableToPlay")}</Text>
            <FocusableButton title={t("common.retry")} variant="retry" onPress={retry} />
          </View>
        ) : hostMode === "video" || hostMode === "pip-active" ? null : (
          <View style={styles.center}>
            <ActivityIndicator color={COLORS.TEXT_PRIMARY} />
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    alignItems: "center",
    paddingHorizontal: SIDE_MARGIN,
    marginBottom: 12,
  },
  frame: {
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
  },
  center: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  dim: {
    backgroundColor: "rgba(0, 0, 0, 0.65)",
    paddingHorizontal: 16,
  },
  errorText: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 16,
    fontWeight: "600",
  },
  reasonText: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: 14,
    textAlign: "center",
  },
  choices: {
    flexDirection: "row",
    alignSelf: "stretch",
    gap: 8,
  },
  choice: {
    flex: 1,
  },
});
