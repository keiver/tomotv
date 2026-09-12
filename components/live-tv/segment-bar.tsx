import { FocusableButton } from "@/components/FocusableButton";
import { GlassSurface } from "@/components/glass-surface";
import { t } from "@/services/i18n";
import React, { useCallback } from "react";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;
const PILL_HEIGHT = IS_TV ? 52 : 34;
const CAPSULE_PADDING = IS_TV ? 6 : 4;
const CAPSULE_RADIUS = PILL_HEIGHT / 2 + CAPSULE_PADDING;

export type LiveTvSegment = "guide" | "channels" | "recordings" | "scheduled";

const SEGMENTS: { key: LiveTvSegment; label: () => string }[] = [
  { key: "guide", label: () => t("liveTv.guide") },
  { key: "channels", label: () => t("liveTv.channels") },
  { key: "recordings", label: () => t("liveTv.recordings") },
  { key: "scheduled", label: () => t("liveTv.scheduled") },
];

interface SegmentBarProps {
  selected: LiveTvSegment;
  onSelect: (segment: LiveTvSegment) => void;
  /** The selected pill's native node: the grid below names it as its Up target. */
  onSelectedRef?: (node: View | null) => void;
}

/** The Live TV screen's sections in one centred glass capsule, the shape of the tab bar above it. */
export function SegmentBar({ selected, onSelect, onSelectedRef }: SegmentBarProps) {
  const selectedRef = useCallback((node: View | null) => onSelectedRef?.(node), [onSelectedRef]);
  return (
    <View style={styles.host}>
      <GlassSurface style={styles.capsule} radius={CAPSULE_RADIUS}>
        {SEGMENTS.map(({ key, label }) => {
          const isSelected = key === selected;
          return (
            <FocusableButton
              key={key}
              ref={isSelected ? selectedRef : undefined}
              title={label()}
              variant={isSelected ? "secondary" : "link"}
              onPress={() => onSelect(key)}
              accessibilityState={{ selected: isSelected }}
              style={styles.pill}
              textStyle={styles.pillText}
            />
          );
        })}
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    alignItems: "center",
    paddingBottom: IS_TV ? 36 : 14,
  },
  // Shape comes from GlassSurface's radius: a borderRadius or overflow here masks the material.
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 4,
    padding: CAPSULE_PADDING,
  },
  pill: {
    minWidth: 0,
    minHeight: PILL_HEIGHT,
    paddingVertical: IS_TV ? 8 : 4,
    paddingHorizontal: IS_TV ? 28 : 16,
  },
  pillText: {
    fontSize: IS_TV ? 22 : 15,
  },
});
