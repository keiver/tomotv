import { GlassSurface } from "@/components/glass-surface";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from "react-native";

const SIZE = 44;

/**
 * Light enough that the photo still reads through the material. GlassSurface's default floor is
 * built for cards over a dark canvas; a control sitting on arbitrary artwork needs the glass to
 * stay glass, and the glyph carries its own contrast from the tint plus the material's dimming.
 */
export const CONTROL_TINT = "rgba(18, 18, 20, 0.30)";

interface GlassIconButtonProps {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  onPress: () => void;
  accessibilityLabel: string;
  accessibilityHint?: string;
  /** Placement only (position/top/left/right). The circle itself is this component's. */
  style?: StyleProp<ViewStyle>;
  iconSize?: number;
  /** The circle's diameter; 44 by default. A smaller one keeps the hit slop's reach. */
  size?: number;
  /** The glyph's colour; the primary text colour by default. */
  color?: string;
  /** Words beside the glyph, in its colour: the circle becomes a capsule of the same height. */
  label?: string;
}

/**
 * Circular Liquid Glass control for floating over full-screen media, which is the case Apple
 * built the material for: chrome that sits on content the viewer still needs to see. Below
 * iOS 26 GlassSurface renders the dark blur instead, so the shape is identical everywhere.
 */
export function GlassIconButton({ icon, onPress, accessibilityLabel, accessibilityHint, style, iconSize = 24, size = SIZE, color = COLORS.TEXT_PRIMARY, label }: GlassIconButtonProps) {
  const shape = label ? [styles.capsule, { height: size, paddingHorizontal: Math.round(size * 0.36) }] : [styles.circle, { width: size, height: size }];
  return (
    <Pressable style={style} onPress={onPress} accessibilityRole="button" accessibilityLabel={accessibilityLabel} accessibilityHint={accessibilityHint} hitSlop={10 + (SIZE - size) / 2}>
      <GlassSurface style={shape} radius={size / 2} tintColor={CONTROL_TINT} interactive>
        <Ionicons name={icon} size={iconSize} color={color} />
        {label ? (
          <Text style={[styles.label, { color, fontSize: Math.round(size * 0.4) }]} numberOfLines={1}>
            {label}
          </Text>
        ) : null}
      </GlassSurface>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Shape comes from GlassSurface's radius prop, not from here: a borderRadius or an overflow
  // in style masks the material instead of shaping it.
  circle: {
    justifyContent: "center",
    alignItems: "center",
  },
  capsule: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 6,
  },
  label: {
    fontWeight: "600",
  },
});
