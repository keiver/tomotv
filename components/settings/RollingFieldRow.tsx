import { ListRow } from "@/components/settings/ListRow";
import { ADD_ROW_PADDING_V, ADD_SERVER_ROW_HEIGHT, settingsStyles } from "@/components/settings/styles";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { Ionicons } from "@expo/vector-icons";
import React, { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, TextInputProps, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const DURATION = 260;
const EASING = Easing.out(Easing.cubic);
const IS_TV = Platform.isTV;

interface RollingFieldRowProps {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  placeholder: string;
  accessibilityLabel?: string;
  keyboardType?: TextInputProps["keyboardType"];
  autoCapitalize?: TextInputProps["autoCapitalize"];
  isFirst?: boolean;
  /** False when a footer closes the card under it. */
  isLast?: boolean;
  value: string;
  onChangeText: (v: string) => void;
  /** Persist the typed value; called as the field gives up the caret. */
  onSave: () => void;
}

export interface RollingFieldRowHandle {
  /** Rolls the field in, as a press on the row does. */
  reveal: () => void;
}

/**
 * A text entry in one list slot, AddServerRow's roll: the row rolls down out of the
 * slot while the field drops in from above to take its place. Whichever is out of
 * the slot leaves layout (`display: none`); a clipped view is still focusable on tvOS.
 */
export const RollingFieldRow = forwardRef<RollingFieldRowHandle, RollingFieldRowProps>(function RollingFieldRow(
  { icon, title, subtitle, placeholder, accessibilityLabel, keyboardType, autoCapitalize, isFirst, isLast = true, value, onChangeText, onSave },
  ref,
) {
  const [open, setOpen] = useState(false);
  // True only while the roll is in flight, when both rows have to be on screen.
  const [rolling, setRolling] = useState(false);
  // Whether the field has held the caret since this reveal, so a blur that
  // precedes its first focus can't be read as the user leaving.
  const editedOnce = useRef(false);
  const { accent } = useCardPalette();
  const fieldRef = useRef<TextInput>(null);

  const progress = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const settle = () => {
      setRolling(false);
      if (open) fieldRef.current?.focus();
    };
    if (reducedMotion) {
      progress.value = open ? 1 : 0;
      settle();
      return;
    }
    progress.value = withTiming(open ? 1 : 0, { duration: DURATION, easing: EASING }, (finished) => {
      if (finished) runOnJS(settle)();
    });
    // The ref keeps a stable identity across renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reducedMotion]);

  const reveal = () => {
    if (open) return;
    editedOnce.current = false;
    setOpen(true);
    setRolling(true);
  };
  useImperativeHandle(ref, () => ({ reveal }));

  // Giving up the caret saves and gives the slot back. Gated on having actually held
  // the caret: the field is focused programmatically the moment the roll settles.
  const handleBlur = () => {
    if (!editedOnce.current) return;
    onSave();
    setOpen(false);
    setRolling(true);
  };

  // Only the row occupying the slot stays in layout once the roll has settled.
  const ctaGone = open && !rolling;
  const fieldGone = !open && !rolling;

  // The CTA starts in the slot and rolls out through the bottom; the field starts
  // one slot above and drops in.
  const ctaStyle = useAnimatedStyle(() => ({ transform: [{ translateY: progress.value * ADD_SERVER_ROW_HEIGHT }] }));
  const fieldStyle = useAnimatedStyle(() => ({ transform: [{ translateY: (progress.value - 1) * ADD_SERVER_ROW_HEIGHT }] }));

  return (
    <View style={styles.slot}>
      <Animated.View style={[styles.layer, ctaStyle, ctaGone && styles.gone]}>
        <ListRow icon={icon} title={title} subtitle={subtitle} onPress={reveal} isFirst={isFirst} isLast={isLast} />
      </Animated.View>

      <Animated.View style={[styles.layer, fieldStyle, fieldGone && styles.gone]}>
        <View style={styles.fieldRow}>
          <Ionicons name={icon} size={IS_TV ? 32 : 22} color={accent} />
          {/* The same shared sunken field the login inputs use; this call site adds layout only. */}
          <SunkenTextInput
            ref={fieldRef}
            containerStyle={styles.fieldWrapper}
            value={value}
            placeholder={placeholder}
            placeholderTextColor={COLORS.TEXT_SECONDARY}
            accessibilityLabel={accessibilityLabel ?? placeholder}
            autoCorrect={false}
            autoCapitalize={autoCapitalize}
            keyboardType={keyboardType}
            onChangeText={onChangeText}
            onFocus={() => {
              editedOnce.current = true;
            }}
            onBlur={handleBlur}
            style={settingsStyles.textInput}
            numberOfLines={1}
            multiline={false}
            clearButtonMode="while-editing"
            returnKeyType="done"
          />
        </View>
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  // Fixed at one slot: the swap happens inside it, so the rows around it never move.
  slot: {
    height: ADD_SERVER_ROW_HEIGHT,
    overflow: "hidden",
  },
  layer: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    height: ADD_SERVER_ROW_HEIGHT,
    justifyContent: "center",
  },
  gone: {
    display: "none",
  },
  // Same horizontal padding and leading gap as a ListRow, so the glyph does not
  // jump as one row replaces the other.
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: IS_TV ? 32 : 20,
    paddingVertical: ADD_ROW_PADDING_V,
    gap: IS_TV ? 16 : 12,
  },
  // Layout only: the card, the inset shadow and the gold focus border come from
  // SunkenTextInput. maxWidth pulls the field just off the row's right edge on TV.
  fieldWrapper: {
    flex: 1,
    width: "auto",
    ...(IS_TV ? { maxWidth: "97%" as const } : null),
  },
});
