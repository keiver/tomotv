import { COLORS } from "@/constants/colors";
import { DESIGN } from "@/constants/app";
import { useCardPalette } from "@/hooks/useCardPalette";
import { hitBadges, hitMeta, SOURCE_MONOGRAM } from "@/services/subtitles/jobText";
import type { SubtitleHit } from "@/services/subtitles/types";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface SubtitleResultRowProps {
  hit: SubtitleHit;
  applying: boolean;
  applied: boolean;
  onPress: () => void;
}

export function SubtitleResultRow({ hit, applying, applied, onPress }: SubtitleResultRowProps) {
  const palette = useCardPalette();
  const badges = hitBadges(hit);
  const meta = hitMeta(hit);
  return (
    <Pressable
      onPress={onPress}
      disabled={applying || applied}
      isTVSelectable
      tvParallaxProperties={{ magnification: 1.0 }}
      accessibilityRole="button"
      accessibilityLabel={hit.name}
      accessibilityState={{ disabled: applying || applied, selected: applied }}
      style={({ focused, pressed }) => [styles.row, focused && { borderColor: palette.accent, backgroundColor: COLORS.SURFACE_RAISED }, pressed && styles.pressed, applied && styles.applied]}>
      {({ focused }) => (
        <View style={styles.content} collapsable={false}>
          <View style={[styles.monogram, hit.hashMatch && { backgroundColor: palette.accent }]}>
            <Text style={[styles.monogramText, hit.hashMatch && { color: palette.onAccent }]}>{SOURCE_MONOGRAM[hit.source]}</Text>
          </View>
          <View style={styles.text}>
            <Text style={[styles.name, focused && styles.nameFocused]} numberOfLines={1}>
              {hit.name}
            </Text>
            <View style={styles.metaRow}>
              {badges.map((badge) => (
                <View key={badge} style={[styles.badge, { borderColor: palette.accent }]}>
                  <Text style={[styles.badgeText, { color: palette.accent }]}>{badge}</Text>
                </View>
              ))}
              <Text style={styles.meta} numberOfLines={1}>
                {meta}
              </Text>
            </View>
          </View>
          {applying ? (
            <ActivityIndicator color={palette.accent} />
          ) : applied ? (
            <Ionicons name="checkmark-circle" size={IS_TV ? 34 : 22} color={palette.accent} />
          ) : (
            <Ionicons name="arrow-down-circle-outline" size={IS_TV ? 34 : 22} color={focused ? palette.accent : COLORS.TEXT_TERTIARY} />
          )}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    borderRadius: DESIGN.BORDER_RADIUS_MEDIUM,
    borderWidth: IS_TV ? 3 : 2,
    borderColor: "transparent",
    paddingVertical: IS_TV ? 16 : 10,
    paddingHorizontal: IS_TV ? 20 : 12,
  },
  pressed: {
    opacity: 0.85,
  },
  applied: {
    opacity: 0.7,
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 20 : 12,
  },
  monogram: {
    width: IS_TV ? 56 : 36,
    height: IS_TV ? 56 : 36,
    borderRadius: DESIGN.BORDER_RADIUS_SMALL,
    backgroundColor: COLORS.SURFACE_MUTED,
    alignItems: "center",
    justifyContent: "center",
  },
  monogramText: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 26 : 16,
    fontWeight: "700",
  },
  text: {
    flex: 1,
    gap: IS_TV ? 6 : 3,
  },
  name: {
    color: COLORS.TEXT_BRIGHT,
    fontSize: IS_TV ? 26 : 15,
    fontWeight: "500",
  },
  nameFocused: {
    color: COLORS.TEXT_PRIMARY,
  },
  metaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 10 : 6,
  },
  badge: {
    borderWidth: 1,
    borderRadius: DESIGN.BORDER_RADIUS_SMALL,
    paddingHorizontal: IS_TV ? 8 : 5,
    paddingVertical: IS_TV ? 2 : 1,
  },
  badgeText: {
    fontSize: IS_TV ? 16 : 11,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  meta: {
    flex: 1,
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 19 : 12,
  },
});
