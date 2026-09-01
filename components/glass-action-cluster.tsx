import { GlassSurface } from "@/components/glass-surface";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { GlassContainer } from "expo-glass-effect";
import React, { useEffect } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from "react-native-reanimated";

const SIZE = 44;
const GAP = 10;
/**
 * UIGlassContainerEffect.spacing: how close two glass elements have to be before they start
 * blending. Wider than the gap on purpose, so the actions read as liquid leaving the trigger
 * rather than as separate buttons appearing beside it.
 */
const MERGE_SPACING = 26;
const SPRING = { damping: 17, stiffness: 220, mass: 0.7 };

export interface GlassAction {
  key: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}

interface GlassActionClusterProps {
  /** Collapsed, this is all there is. Pressing it toggles the rest. */
  triggerIcon: React.ComponentProps<typeof Ionicons>["name"];
  triggerLabel: string;
  actions: GlassAction[];
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  /** Placement only. The cluster owns its own size. */
  style?: StyleProp<ViewStyle>;
}

/**
 * One glass control that opens into several, the iOS 26 pattern: glass elements nested in a
 * UIGlassContainerEffect merge while they are within its spacing, so actions travelling out of
 * the trigger read as one body of liquid separating rather than buttons fading in.
 *
 * Below iOS 26 GlassSurface renders the dark blur and the container has no effect to apply, so
 * the same actions simply slide out as blurred circles.
 */
export function GlassActionCluster({ triggerIcon, triggerLabel, actions, expanded, onExpandedChange, style }: GlassActionClusterProps) {
  const progress = useSharedValue(expanded ? 1 : 0);

  useEffect(() => {
    progress.set(withSpring(expanded ? 1 : 0, SPRING));
  }, [expanded, progress]);

  const width = SIZE + actions.length * (SIZE + GAP);

  return (
    <View style={[style, { width, height: SIZE }]} pointerEvents="box-none">
      <GlassContainer spacing={MERGE_SPACING} style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {actions.map((action, index) => (
          <ClusterAction key={action.key} action={action} index={index} progress={progress} expanded={expanded} onExpandedChange={onExpandedChange} />
        ))}
        <Pressable style={styles.slot} onPress={() => onExpandedChange(!expanded)} accessibilityRole="button" accessibilityLabel={triggerLabel} accessibilityState={{ expanded }} hitSlop={10}>
          <GlassSurface style={styles.circle} radius={SIZE / 2} tintColor={CONTROL_TINT} interactive>
            <Ionicons name={triggerIcon} size={22} color={COLORS.TEXT_PRIMARY} />
          </GlassSurface>
        </Pressable>
      </GlassContainer>
    </View>
  );
}

/**
 * Parked under the trigger while collapsed and pulled out to its slot as the spring runs, which
 * is what the container has to see to blend them. Rendered even when collapsed: a mounted glass
 * element is what morphs, where one that mounts on expansion can only appear.
 */
function ClusterAction({
  action,
  index,
  progress,
  expanded,
  onExpandedChange,
}: {
  action: GlassAction;
  index: number;
  progress: { value: number };
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
}) {
  const offset = (index + 1) * (SIZE + GAP);
  // Position only. Apple: alpha below 1 on a UIVisualEffectView or ANY superview composites it
  // offscreen and the effect renders wrong or not at all, and a spring settles asymptotically,
  // so a wrapper faded to "1" can rest at 0.9998 and leave the glass broken for good. Alpha
  // inside the contentView is the supported place, so the icon fades and the material does not.
  const animated = useAnimatedStyle(() => ({
    transform: [{ translateX: -offset * (1 - progress.value) }],
  }));
  const iconFade = useAnimatedStyle(() => ({ opacity: progress.value }));

  return (
    <Animated.View style={[styles.slot, { left: offset }, animated]} pointerEvents={expanded ? "auto" : "none"}>
      <Pressable
        onPress={() => {
          onExpandedChange(false);
          action.onPress();
        }}
        accessibilityRole="button"
        accessibilityLabel={action.label}
        hitSlop={10}>
        <GlassSurface style={styles.circle} radius={SIZE / 2} tintColor={CONTROL_TINT} interactive>
          <Animated.View style={iconFade}>
            <Ionicons name={action.icon} size={22} color={COLORS.TEXT_PRIMARY} />
          </Animated.View>
        </GlassSurface>
      </Pressable>
    </Animated.View>
  );
}

/** Matches GlassIconButton: light enough that the media still reads through the material. */
const CONTROL_TINT = "rgba(18, 18, 20, 0.30)";

const styles = StyleSheet.create({
  slot: {
    position: "absolute",
    top: 0,
    left: 0,
    width: SIZE,
    height: SIZE,
  },
  // No borderRadius or overflow here: both would mask the material. GlassSurface shapes it
  // through the native corner configuration instead.
  circle: {
    width: SIZE,
    height: SIZE,
    justifyContent: "center",
    alignItems: "center",
  },
});
