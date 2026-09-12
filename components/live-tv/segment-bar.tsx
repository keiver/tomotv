import { FocusableButton } from "@/components/FocusableButton";
import { t } from "@/services/i18n";
import React, { useCallback } from "react";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;

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

/** The Live TV screen's sections, drawn in the content like every TV header in the app. */
export function SegmentBar({ selected, onSelect, onSelectedRef }: SegmentBarProps) {
  const selectedRef = useCallback((node: View | null) => onSelectedRef?.(node), [onSelectedRef]);
  return (
    <View style={styles.row}>
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
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 16 : 8,
    paddingBottom: IS_TV ? 18 : 10,
  },
  pill: {
    minWidth: 0,
    minHeight: IS_TV ? 52 : 34,
    paddingVertical: IS_TV ? 8 : 4,
    paddingHorizontal: IS_TV ? 28 : 16,
  },
  pillText: {
    fontSize: IS_TV ? 22 : 15,
  },
});
