import { GuideDayPicker } from "@/components/live-tv/guide-day-picker";
import { HUD_CELL_BACKGROUND } from "@/components/live-tv/guide-group-cell";
import { COLORS } from "@/constants/colors";
import type { GuideDay } from "@/hooks/useGuide";
import { t } from "@/services/i18n";
import { dayStripFirst, formatDayBox, formatDayHeading, guideMetrics } from "@/utils/guide";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";

const IS_TV = Platform.isTV;
/** Days in view: one box over each corner action under the strip. */
export const DAYS_IN_VIEW = 4;
/** The full channel column split in four; whole points on TV, where the focus snap floors to it. */
export const DAY_BOX = guideMetrics(IS_TV).channelColumnWidth / DAYS_IN_VIEW;
/** Days without listings read as present but dimmed, the HUD's disabled tone. */
const DIM_NO_LISTINGS = 0.35;
/** The group cells' pick: a green wash over the black floor. */
const WASH_SELECTED = "rgba(52, 199, 89, 0.2)";

interface GuideDayStripProps {
  days: readonly GuideDay[];
  /** The picked day's local midnight. */
  selectedMs: number;
  nowMs: number;
  onSelect: (dayMs: number) => void;
}

/**
 * The day picker over the channel column: the day's heading, then four day boxes styled as the corner
 * actions under them, scrolling box by box. TV: a press opens the guide on that day, today again returns to now.
 * Phone: a touch opens the system calendar, which picks instead.
 */
export function GuideDayStrip({ days, selectedMs, nowMs, onSelect }: GuideDayStripProps) {
  const scrollRef = useRef<ScrollView>(null);
  // TV: the heading follows the focused box; a press moves the pick to it.
  const [focusedMs, setFocusedMs] = useState<number | null>(null);
  // The first day in view: focus moves it on TV, a settled swipe on phone.
  const [first, setFirst] = useState(0);
  const firstRef = useRef(first);
  const moveFirst = useCallback((next: number) => {
    firstRef.current = next;
    setFirst(next);
  }, []);
  const selectedIndex = Math.max(
    0,
    days.findIndex((day) => day.startMs === selectedMs),
  );
  // A pick out of view, today again after a reset, slides in to the nearer edge.
  useEffect(() => {
    const next = dayStripFirst(selectedIndex, firstRef.current, DAYS_IN_VIEW);
    if (next === firstRef.current) return;
    scrollRef.current?.scrollTo({ x: next * DAY_BOX, animated: true });
    moveFirst(next);
  }, [selectedIndex, moveFirst]);
  const handleFocus = useCallback(
    (index: number) => {
      setFocusedMs(days[index]?.startMs ?? null);
      moveFirst(dayStripFirst(index, firstRef.current, DAYS_IN_VIEW));
    },
    [days, moveFirst],
  );
  const blur = useCallback(() => setFocusedMs(null), []);
  // Phone: any touch on the strip opens the system calendar instead of picking a box.
  const [pickerOpen, setPickerOpen] = useState(false);
  const openPicker = useCallback(() => setPickerOpen(true), []);
  const handleSettle = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => moveFirst(Math.round(event.nativeEvent.contentOffset.x / DAY_BOX)), [moveFirst]);
  const labels = { today: t("liveTv.today"), tomorrow: t("liveTv.tomorrow") };
  const heading = formatDayHeading(focusedMs ?? selectedMs, nowMs, labels);

  return (
    <View style={styles.strip}>
      {IS_TV ? null : <GuideDayPicker days={days} selectedMs={selectedMs} open={pickerOpen} onOpenChange={setPickerOpen} onSelect={onSelect} />}
      <Text style={styles.heading} numberOfLines={1} onPress={IS_TV ? undefined : openPicker}>
        {heading}
      </Text>
      <View style={styles.boxes}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          // TV: each box's snap offset lands a focus past either edge flush on that edge; phone: a swipe rests on a box edge.
          snapToInterval={DAY_BOX}
          snapToAlignment={IS_TV ? "item" : undefined}
          decelerationRate="fast"
          onScrollEndDrag={IS_TV ? undefined : handleSettle}
          onMomentumScrollEnd={IS_TV ? undefined : handleSettle}>
          {days.map((day, index) => (
            <DayBox
              key={day.startMs}
              index={index}
              day={day}
              selected={day.startMs === selectedMs}
              label={formatDayHeading(day.startMs, nowMs, labels)}
              snapOffset={IS_TV ? Math.min(Math.max(index - first, 0), DAYS_IN_VIEW - 1) * DAY_BOX : undefined}
              onPress={IS_TV ? onSelect : openPicker}
              onFocus={handleFocus}
              onBlur={blur}
            />
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

interface DayBoxProps {
  index: number;
  day: GuideDay;
  selected: boolean;
  label: string;
  /** TV: where in the strip the focus scroll lands this box. */
  snapOffset?: number;
  onPress: (dayMs: number) => void;
  onFocus: (index: number) => void;
  onBlur: () => void;
}

/** One day as a corner action cell: frosted black, square, the cells' gold ring on focus over the groups' wash when picked. */
function DayBox({ index, day, selected, label, snapOffset, onPress, onFocus, onBlur }: DayBoxProps) {
  const [focused, setFocused] = useState(false);
  // TV: read only without listings, focusable so the strip still browses past it, presses drop.
  const noListings = day.hasListings === false;
  const readOnly = noListings && IS_TV;
  return (
    <View style={[styles.tile, selected && styles.tileSelected]} scrollSnapOffset={snapOffset}>
      <Pressable
        onPress={readOnly ? undefined : () => onPress(day.startMs)}
        onFocus={() => {
          setFocused(true);
          onFocus(index);
        }}
        onBlur={() => {
          setFocused(false);
          onBlur();
        }}
        isTVSelectable
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${t(noListings ? "liveTv.dayNoListings" : "liveTv.dayListings")}`}
        accessibilityState={{ selected, disabled: readOnly }}
        tvParallaxProperties={{ enabled: false }}
        style={styles.hit}>
        {focused ? <View style={styles.focusRing} pointerEvents="none" /> : null}
        <Text style={[styles.day, noListings && styles.dayNoListings]} numberOfLines={1}>
          {formatDayBox(day.startMs)}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    flex: 1,
    paddingTop: 2,
  },
  heading: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 13,
    lineHeight: IS_TV ? 22 : 13,
    fontWeight: "600",
    textTransform: "uppercase",
    textAlign: "center",
    paddingHorizontal: IS_TV ? 12 : 8,
    paddingBottom: 4,
    marginBottom: IS_TV ? 0 : 2,
  },
  boxes: {
    flex: 1,
  },
  tile: {
    width: DAY_BOX,
    backgroundColor: HUD_CELL_BACKGROUND,
  },
  tileSelected: {
    backgroundColor: WASH_SELECTED,
  },
  hit: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  // The program cells' focus mark.
  focusRing: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderWidth: IS_TV ? 2 : 1,
    borderColor: COLORS.ACCENT,
  },
  day: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 24 : 14,
    fontWeight: "600",
  },
  dayNoListings: {
    opacity: DIM_NO_LISTINGS,
  },
});
