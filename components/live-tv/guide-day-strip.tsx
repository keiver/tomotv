import { COLORS } from "@/constants/colors";
import type { GuideDay } from "@/hooks/useGuide";
import { t } from "@/services/i18n";
import { formatDayCircle, formatDayHeading } from "@/utils/guide";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
/** A circle, the gap between two, and the strip's side insets: four circles fit the full channel column. */
export const DAY_CIRCLE = IS_TV ? 48 : 26;
export const DAY_GAP = IS_TV ? 12 : 6;
export const DAY_INSET = IS_TV ? 12 : 8;
/** Days without listings read as present but dimmed, the HUD's disabled tone. */
const DIM_NO_LISTINGS = 0.35;
const FILL_SELECTED_FOCUSED = "#FFFFFF";

interface GuideDayStripProps {
  days: readonly GuideDay[];
  /** The picked day's local midnight. */
  selectedMs: number;
  nowMs: number;
  onSelect: (dayMs: number) => void;
}

/**
 * The day picker over the channel column: the day's heading, then one circle per day the guide
 * offers, the picked one first. A press opens the guide on that day; the picked one again, today, returns to now.
 */
export function GuideDayStrip({ days, selectedMs, nowMs, onSelect }: GuideDayStripProps) {
  const scrollRef = useRef<ScrollView>(null);
  // TV: the heading follows the focused circle; a press moves the pick to it.
  const [focusedMs, setFocusedMs] = useState<number | null>(null);
  const step = DAY_CIRCLE + DAY_GAP;
  const selectedIndex = Math.max(
    0,
    days.findIndex((day) => day.startMs === selectedMs),
  );
  useEffect(() => {
    scrollRef.current?.scrollTo({ x: selectedIndex * step, animated: false });
  }, [selectedIndex, step]);
  const labels = { today: t("liveTv.today"), tomorrow: t("liveTv.tomorrow") };
  const heading = formatDayHeading(focusedMs ?? selectedMs, nowMs, labels);
  const blur = useCallback(() => setFocusedMs(null), []);

  return (
    <View style={styles.strip}>
      <Text style={styles.heading} numberOfLines={1}>
        {heading}
      </Text>
      <ScrollView ref={scrollRef} horizontal showsHorizontalScrollIndicator={false} snapToInterval={step} decelerationRate="fast" contentContainerStyle={styles.circles}>
        {days.map((day) => (
          <DayCircle key={day.startMs} day={day} selected={day.startMs === selectedMs} label={formatDayHeading(day.startMs, nowMs, labels)} onPress={onSelect} onFocus={setFocusedMs} onBlur={blur} />
        ))}
      </ScrollView>
    </View>
  );
}

interface DayCircleProps {
  day: GuideDay;
  selected: boolean;
  label: string;
  onPress: (dayMs: number) => void;
  onFocus: (dayMs: number) => void;
  onBlur: () => void;
}

function DayCircle({ day, selected, label, onPress, onFocus, onBlur }: DayCircleProps) {
  const [focused, setFocused] = useState(false);
  const text = formatDayCircle(day.startMs);
  const month = text.length > 2;
  return (
    <Pressable
      onPress={() => onPress(day.startMs)}
      onFocus={() => {
        setFocused(true);
        onFocus(day.startMs);
      }}
      onBlur={() => {
        setFocused(false);
        onBlur();
      }}
      isTVSelectable
      accessibilityRole="button"
      accessibilityLabel={`${label}, ${t(day.hasListings === false ? "liveTv.dayNoListings" : "liveTv.dayListings")}`}
      accessibilityState={{ selected }}
      tvParallaxProperties={{ enabled: false }}
      style={[
        styles.circle,
        selected && styles.circleSelected,
        focused && styles.circleFocused,
        selected && focused && styles.circleSelectedFocused,
        day.hasListings === false && styles.circleNoListings,
      ]}>
      <Text style={[styles.day, month && styles.month, (selected || (focused && IS_TV)) && styles.daySelected]} numberOfLines={1}>
        {text}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flex: 1,
    paddingTop: IS_TV ? 2 : 2,
  },
  heading: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 17 : 11,
    lineHeight: IS_TV ? 22 : 13,
    fontWeight: "600",
    paddingHorizontal: DAY_INSET,
    marginBottom: IS_TV ? 0 : 2,
  },
  circles: {
    paddingHorizontal: DAY_INSET,
    gap: DAY_GAP,
    alignItems: "center",
  },
  circle: {
    width: DAY_CIRCLE,
    height: DAY_CIRCLE,
    borderRadius: DAY_CIRCLE / 2,
    borderWidth: IS_TV ? 2 : 1.5,
    borderColor: COLORS.ACCENT,
    alignItems: "center",
    justifyContent: "center",
  },
  circleSelected: {
    backgroundColor: COLORS.ACCENT,
  },
  // The cells' focus mark turns the ring white and thick; a focused pick fills white like a focused group cell.
  circleFocused: {
    borderColor: FILL_SELECTED_FOCUSED,
    borderWidth: IS_TV ? 3 : 1.5,
  },
  circleSelectedFocused: {
    backgroundColor: FILL_SELECTED_FOCUSED,
  },
  circleNoListings: {
    opacity: DIM_NO_LISTINGS,
  },
  day: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "600",
  },
  month: {
    fontSize: IS_TV ? 14 : 9,
  },
  daySelected: {
    color: COLORS.ON_ACCENT,
  },
});
