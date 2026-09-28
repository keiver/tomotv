import { LiveClipView } from "@/modules/live-clip";
import { type LiveFrame } from "@/services/liveFrames";
import React from "react";
import { StyleSheet } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/**
 * The focused channel card's preview clip: the channel's own few seconds of video, looped muted
 * with a hard cut at the seam so it reads as a preview. Nothing plays under Reduce Motion.
 */
export function LiveClip({ clip }: { clip: LiveFrame }) {
  const reducedMotion = useReducedMotion();
  if (reducedMotion) return null;
  return <LiveClipView uri={clip.uri} style={StyleSheet.absoluteFill} />;
}
