import { COLORS } from "@/constants/colors";
import { STAGE_HINT_AFTER_SECONDS, stageHint, stageLabel, usePlaybackStage } from "@/hooks/usePlaybackStage";
import type { PlaybackStage } from "@/services/playbackStage";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, LayoutChangeEvent, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/**
 * The player's black loading canvas, and on tvOS the screen's focus anchor.
 *
 * The anchor cannot be a sibling of this overlay. react-native-tvos Fabric
 * forces `isUserInteractionEnabled = YES` on plain views, so an opaque absolute
 * overlay occludes UIKit focus for everything beneath it (`pointerEvents` cannot
 * opt out) — which is every focusable the player has while it loads: AVKit's
 * transport bar, and the invisible holders this component replaces. With focus
 * stranded outside the pushed screen, Menu finds no responder chain to the
 * navigation controller and the system backgrounds the app instead of popping
 * (see memories/CLAUDE-lessons-learned.md — the audio-player Menu case and the
 * PR #61 overlay case).
 *
 * So the topmost view IS the focusable: by construction nothing can occlude it,
 * and no future overlay can silently break Menu by out-stacking a holder's
 * zIndex. Menu handling stays zero-JS.
 */
export function PlayerLoadingOverlay({ title }: { title?: string }) {
  const body = (
    <>
      <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} />
      <PlaybackStageLog title={title} />
    </>
  );
  if (Platform.isTV) {
    return (
      <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.overlay} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {body}
      </Pressable>
    );
  }

  return <View style={styles.overlay}>{body}</View>;
}

/** A row stays this long once it is both on screen and passed. */
export const HOLD_MS = 3000;
/** Rows arrive at most this often, so a burst of stages reads as a sequence. */
export const GAP_MS = 600;
/** Rows on screen at most; over it the oldest leaves early. */
export const MAX_ROWS = 5;
const ENTER_MS = 360;
export const FADE_MS = 450;
const COLLAPSE_MS = 280;
const ROW_GAP = Platform.isTV ? 10 : 6;
/** A maxHeight no row reaches; the leave animation pulls it down from the measured height. */
const OPEN_HEIGHT = 1000;

export interface StageRowState {
  key: number;
  stage: PlaybackStage;
  /** Epoch ms the stage began; 0 when it began before this log saw it. */
  since: number;
  /** Epoch ms the stage passed; 0 while it runs. */
  until: number;
  shownAt: number;
  /** Latched once the stage ran long, kept until the row leaves. */
  hint: boolean;
  leaving: boolean;
}

/** Rows due to leave get `leaving`; the same array comes back when none is. */
export function markLeaving(rows: StageRowState[], now: number): StageRowState[] {
  const staying = rows.filter((row) => !row.leaving);
  const due = new Set<number>();
  staying.forEach((row, index) => {
    if (index < staying.length - MAX_ROWS) due.add(row.key);
    else if (row.until && Math.max(row.shownAt, row.until) + HOLD_MS <= now) due.add(row.key);
  });
  return due.size ? rows.map((row) => (due.has(row.key) ? { ...row, leaving: true } : row)) : rows;
}

/** When the next row falls due, or Infinity. */
export function nextLeaveAt(rows: StageRowState[]): number {
  return rows.reduce((at, row) => (row.leaving || !row.until ? at : Math.min(at, Math.max(row.shownAt, row.until) + HOLD_MS)), Infinity);
}

const settle = (rows: StageRowState[], at: number) => rows.map((row) => (row.until ? row : { ...row, until: at }));

/**
 * The stages as a corner log, newest lowest. Rows arrive one at a time, hold long enough to
 * read, then fade and fold shut, so the rows below glide up instead of jumping.
 */
function PlaybackStageLog({ title }: { title?: string }) {
  const { stage, since, passed, elapsedSeconds } = usePlaybackStage();
  const insets = useSafeAreaInsets();
  const [rows, setRows] = useState<StageRowState[]>([]);
  const pending = useRef<StageRowState[]>([]);
  const seen = useRef({ count: 0, since: 0 });
  const nextKey = useRef(0);
  const lastShownAt = useRef(0);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const release = useCallback(function tick() {
    releaseTimer.current = null;
    const next = pending.current[0];
    if (!next) return;
    const wait = lastShownAt.current + GAP_MS - Date.now();
    if (wait > 0) {
      releaseTimer.current = setTimeout(tick, wait);
      return;
    }
    pending.current.shift();
    lastShownAt.current = Date.now();
    setRows((current) => [...current, { ...next, shownAt: lastShownAt.current }]);
    if (pending.current.length) releaseTimer.current = setTimeout(tick, GAP_MS);
  }, []);
  useEffect(
    () => () => {
      if (releaseTimer.current) clearTimeout(releaseTimer.current);
    },
    [],
  );

  // The store's attempt against what this log has queued: a longer sequence appends its new
  // stages, a shorter or restarted one closes every row and starts over.
  useEffect(() => {
    const now = Date.now();
    const sequence: PlaybackStage[] = stage ? [...passed, stage] : [];
    if (sequence.length === seen.current.count && since === seen.current.since) return;
    const first = seen.current.count === 0 && rows.length === 0 && pending.current.length === 0;
    const fresh = sequence.length > seen.current.count ? sequence.slice(seen.current.count) : sequence;
    const endedAt = fresh.length === 1 ? since : now;
    seen.current = { count: sequence.length, since };
    pending.current = settle(pending.current, endedAt);
    setRows((current) => settle(current, endedAt));
    if (!fresh.length) return;
    const added = fresh.map((next, index) => ({
      key: nextKey.current++,
      stage: next,
      since: index === fresh.length - 1 ? since : 0,
      until: index === fresh.length - 1 ? 0 : now,
      shownAt: now,
      hint: false,
      leaving: false,
    }));
    if (first) {
      // Stages already passed when the log opens are history: on screen at once, the newest few.
      lastShownAt.current = now;
      setRows(added.slice(-MAX_ROWS));
      return;
    }
    pending.current.push(...added);
    release();
    // Rows are read for the first-open case only; the store's change is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, since, passed, release]);

  useEffect(() => {
    if (elapsedSeconds < STAGE_HINT_AFTER_SECONDS) return;
    setRows((current) => (current.some((row) => row.since === since && !row.hint) ? current.map((row) => (row.since === since ? { ...row, hint: true } : row)) : current));
  }, [elapsedSeconds, since]);

  useEffect(() => {
    const now = Date.now();
    const marked = markLeaving(rows, now);
    if (marked !== rows) {
      setRows(marked);
      return;
    }
    const at = nextLeaveAt(rows);
    if (at === Infinity) return;
    const timer = setTimeout(() => setRows((current) => markLeaving(current, Date.now())), at - now + 1);
    return () => clearTimeout(timer);
  }, [rows]);

  const onGone = useCallback((key: number) => setRows((current) => current.filter((row) => row.key !== key)), []);

  if (!rows.length) return null;
  return (
    <View pointerEvents="none" style={[styles.corner, { top: (Platform.isTV ? 60 : 16) + insets.top, left: (Platform.isTV ? 80 : 16) + insets.left }]}>
      {title ? (
        <Text style={styles.title} numberOfLines={1}>
          {title}
        </Text>
      ) : null}
      {rows.map((row) => (
        <StageRow key={row.key} row={row} seconds={rowSeconds(row, since, elapsedSeconds)} onGone={onGone} />
      ))}
    </View>
  );
}

/** The row's clock: live while its stage runs, frozen at the stage's length once it passed. */
function rowSeconds(row: StageRowState, since: number, elapsedSeconds: number): number {
  if (!row.since) return 0;
  if (row.until) return Math.floor((row.until - row.since) / 1000);
  return row.since === since ? elapsedSeconds : 0;
}

function StageRow({ row, seconds, onGone }: { row: StageRowState; seconds: number; onGone: (key: number) => void }) {
  const reducedMotion = useReducedMotion();
  const opacity = useSharedValue(reducedMotion ? 1 : 0);
  const slide = useSharedValue(reducedMotion ? 0 : -10);
  const dim = useSharedValue(1);
  const maxHeight = useSharedValue(OPEN_HEIGHT);
  const gap = useSharedValue(ROW_GAP);
  const clock = useSharedValue(0);
  const hint = useSharedValue(0);
  const measured = useRef(0);
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    measured.current = event.nativeEvent.layout.height;
  }, []);

  useEffect(() => {
    if (reducedMotion) return;
    opacity.set(withTiming(1, { duration: ENTER_MS, easing: Easing.out(Easing.quad) }));
    slide.set(withTiming(0, { duration: ENTER_MS, easing: Easing.out(Easing.cubic) }));
  }, [reducedMotion, opacity, slide]);

  const running = !row.until;
  useEffect(() => {
    if (running) return;
    dim.set(reducedMotion ? 0.62 : withTiming(0.62, { duration: FADE_MS }));
  }, [running, reducedMotion, dim]);

  const showClock = seconds >= 2;
  useEffect(() => {
    if (showClock) clock.set(reducedMotion ? 1 : withTiming(1, { duration: ENTER_MS }));
  }, [showClock, reducedMotion, clock]);
  useEffect(() => {
    if (row.hint) hint.set(reducedMotion ? 1 : withTiming(1, { duration: ENTER_MS }));
  }, [row.hint, reducedMotion, hint]);

  useEffect(() => {
    if (!row.leaving) return;
    const collapse = !reducedMotion && measured.current > 0;
    opacity.set(withTiming(0, { duration: FADE_MS, easing: Easing.in(Easing.quad) }));
    if (collapse) {
      const fold = { duration: COLLAPSE_MS, easing: Easing.inOut(Easing.quad) };
      maxHeight.set(measured.current);
      maxHeight.set(withDelay(FADE_MS, withTiming(0, fold)));
      gap.set(withDelay(FADE_MS, withTiming(0, fold)));
    }
    // A little past the fold, so the unmount lands on a row already at zero height.
    const timer = setTimeout(() => onGone(row.key), FADE_MS + (collapse ? COLLAPSE_MS : 0) + 50);
    return () => clearTimeout(timer);
  }, [row.leaving, row.key, reducedMotion, onGone, opacity, maxHeight, gap]);

  const rowStyle = useAnimatedStyle(() => ({ opacity: opacity.value, maxHeight: maxHeight.value, marginBottom: gap.value, transform: [{ translateX: slide.value }] }));
  const dimStyle = useAnimatedStyle(() => ({ opacity: dim.value }));
  const clockStyle = useAnimatedStyle(() => ({ opacity: clock.value }));
  const hintStyle = useAnimatedStyle(() => ({ opacity: hint.value }));
  return (
    <Animated.View onLayout={onLayout} style={[styles.row, rowStyle]}>
      <Animated.View style={[styles.line, dimStyle]}>
        <View style={styles.pill}>
          <Text style={styles.pillText} numberOfLines={1}>
            {stageLabel(row.stage)}
          </Text>
          {row.hint ? (
            <Animated.Text style={[styles.hint, hintStyle]} numberOfLines={2}>
              {stageHint(row.stage)}
            </Animated.Text>
          ) : null}
        </View>
        <Animated.Text style={[styles.clock, clockStyle]}>{showClock ? `${seconds}s` : ""}</Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    zIndex: 100,
  },
  corner: {
    position: "absolute",
    alignItems: "flex-start",
    maxWidth: Platform.isTV ? 760 : 320,
  },
  title: {
    fontSize: Platform.isTV ? 24 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_TERTIARY,
    marginBottom: Platform.isTV ? 14 : 8,
    marginLeft: Platform.isTV ? 4 : 2,
  },
  row: {
    alignSelf: "flex-start",
    overflow: "hidden",
  },
  line: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  pill: {
    flexShrink: 1,
    backgroundColor: "rgba(28, 28, 30, 0.92)",
    borderColor: "rgba(255, 255, 255, 0.12)",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: Platform.isTV ? 16 : 10,
    paddingHorizontal: Platform.isTV ? 22 : 12,
    paddingVertical: Platform.isTV ? 12 : 7,
  },
  pillText: {
    fontSize: Platform.isTV ? 26 : 15,
    lineHeight: Platform.isTV ? 32 : 20,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
  clock: {
    marginLeft: Platform.isTV ? 14 : 8,
    paddingVertical: Platform.isTV ? 12 : 7,
    fontSize: Platform.isTV ? 22 : 13,
    lineHeight: Platform.isTV ? 32 : 20,
    fontVariant: ["tabular-nums"],
    color: COLORS.TEXT_SECONDARY,
  },
  hint: {
    marginTop: Platform.isTV ? 6 : 4,
    fontSize: Platform.isTV ? 21 : 13,
    color: COLORS.TEXT_SECONDARY,
    lineHeight: Platform.isTV ? 28 : 18,
  },
});
