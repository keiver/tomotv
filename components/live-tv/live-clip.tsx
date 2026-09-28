import { LiveClipView } from "@/modules/live-clip";
import { LIVE_CLIP_SCROLL_SETTLE_MS, type LiveFrame } from "@/services/liveFrames";
import React, { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/** When the last clip's card took focus: one taken right after it is a scroll passing through. */
let lastArrivalAt = 0;

/**
 * The focused channel card's preview clip: the channel's own few seconds of video, looped muted
 * with a hard cut at the seam. Focus at rest plays it at once; mid-scroll it waits for focus to
 * settle, so a scroll past starts no player. Nothing plays under Reduce Motion.
 */
export function LiveClip({ clip }: { clip: LiveFrame }) {
  const reducedMotion = useReducedMotion();
  const [settled, setSettled] = useState(() => Date.now() - lastArrivalAt >= LIVE_CLIP_SCROLL_SETTLE_MS);
  useEffect(() => {
    lastArrivalAt = Date.now();
    const timer = setTimeout(() => setSettled(true), LIVE_CLIP_SCROLL_SETTLE_MS);
    return () => clearTimeout(timer);
  }, []);
  if (reducedMotion || !settled) return null;
  return <LiveClipView uri={clip.uri} style={StyleSheet.absoluteFill} />;
}
