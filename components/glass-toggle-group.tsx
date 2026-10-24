import { FocusableButton } from "@/components/FocusableButton";
import { CAPSULE_PADDING, GLASS_PILL_PARALLAX } from "@/components/glass-button";
import { GlassSurface } from "@/components/glass-surface";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { withAlpha } from "@/utils/color";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
export const GLASS_CIRCLE = IS_TV ? 62 : 44;
/** One control's column: wide enough for its word, so neighbours never crowd it. */
export const GLASS_SLOT = IS_TV ? 100 : 60;
const ICON = IS_TV ? 30 : 20;
const ICON_OFF_ALPHA = 0.5;
const INSET = (GLASS_SLOT - GLASS_CIRCLE) / 2 - CAPSULE_PADDING;

export interface GlassToggle {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  offIcon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  focused: boolean;
  /** One word under the circle. */
  word: string;
  /** The press it makes, spoken. */
  accessibilityLabel: string;
  onPress: () => void;
  onFocus: () => void;
  onBlur: () => void;
}

/** The one word under a glass control. */
export function GlassWord({ children }: { children: string }) {
  return (
    <Text style={styles.word} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} accessibilityElementsHidden importantForAccessibility="no">
      {children}
    </Text>
  );
}

/** Toggles sharing one glass capsule: on is a solid accent circle, off the clear glass with a dim glyph. */
export function GlassToggleGroup({ toggles }: { toggles: GlassToggle[] }) {
  const palette = useCardPalette();
  return (
    <View style={styles.group}>
      {/* Behind the toggles, never above them. */}
      <GlassSurface style={styles.capsule} radius={GLASS_CIRCLE / 2 + CAPSULE_PADDING} tintColor={withAlpha(palette.accent, 0.067)} pointerEvents="none" />
      {toggles.map((toggle) => (
        <View key={toggle.key} style={styles.slot}>
          <View style={styles.circleWell}>
            <FocusableButton
              variant={toggle.selected ? "primary" : "link"}
              style={StyleSheet.flatten([styles.circle, toggle.focused && !toggle.selected && { backgroundColor: withAlpha(palette.accent, 0.35) }])}
              icon={
                <Ionicons
                  name={toggle.selected ? toggle.icon : toggle.offIcon}
                  size={ICON}
                  color={toggle.selected ? palette.onAccent : toggle.focused ? COLORS.TEXT_PRIMARY : withAlpha(palette.accent, ICON_OFF_ALPHA)}
                />
              }
              tvParallaxProperties={GLASS_PILL_PARALLAX}
              accessibilityLabel={toggle.accessibilityLabel}
              accessibilityState={{ selected: toggle.selected }}
              onFocus={toggle.onFocus}
              onBlur={toggle.onBlur}
              onPress={toggle.onPress}
            />
          </View>
          <GlassWord>{toggle.word}</GlassWord>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: {
    flexDirection: "row",
  },
  // Shape comes from GlassSurface's radius: a borderRadius or overflow here masks the material.
  capsule: {
    position: "absolute",
    top: 0,
    left: INSET,
    right: INSET,
    height: GLASS_CIRCLE + CAPSULE_PADDING * 2,
  },
  slot: {
    width: GLASS_SLOT,
    alignItems: "center",
  },
  // The capsule's padding around each circle, so a toggle stands as tall as a GlassButton circle.
  circleWell: {
    paddingVertical: CAPSULE_PADDING,
  },
  // Sizing and no shadow only: the variant's focus border has to land.
  circle: {
    width: GLASS_CIRCLE,
    height: GLASS_CIRCLE,
    minWidth: 0,
    minHeight: GLASS_CIRCLE,
    paddingVertical: 0,
    paddingHorizontal: 0,
    shadowOpacity: 0,
    elevation: 0,
    boxShadow: "none",
  },
  word: {
    width: GLASS_SLOT,
    marginTop: IS_TV ? 8 : 4,
    fontSize: IS_TV ? 20 : 12,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
});
