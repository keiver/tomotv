import { GlassButton } from "@/components/glass-button";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, TextInput, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const DURATION = 260;
const EASING = Easing.out(Easing.cubic);
/** The revealed field's width; the glass capsule slides this far left to make room. */
const FIELD_WIDTH = 480;
const FIELD_GAP = 16;

interface HeaderSearchRevealProps {
  value: string;
  onChangeText: (v: string) => void;
  placeholder: string;
}

/**
 * The grid bar's search: a glass magnifier capsule alone at rest. Pressing it slides the capsule
 * left while the field grows open at its right, and takes the caret. Giving the caret up with an
 * empty term closes it the same way. AddServerRow's reveal, laid on its side: whichever state is
 * out of the slot leaves layout (width 0 + hidden), a merely clipped view is still focusable on tvOS.
 */
export function HeaderSearchReveal({ value, onChangeText, placeholder }: HeaderSearchRevealProps) {
  const [open, setOpen] = useState(false);
  const [rolling, setRolling] = useState(false);
  // Whether the field has held the caret since this reveal, so a blur that
  // precedes its first focus can't be read as the user leaving.
  const editedOnce = useRef(false);
  const fieldRef = useRef<TextInput>(null);
  // What the field holds, kept out of state: any render while the tvOS keyboard
  // is up dismisses it, so the term only leaves on the keyboard's Search key.
  const draft = useRef(value);

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
  // An empty committed term gives the slot back; a searched term stays open with its results.
  const handleBlur = () => {
    if (!editedOnce.current || value.trim()) return;
    draft.current = "";
    fieldRef.current?.clear();
    setOpen(false);
    setRolling(true);
  };

  const fieldGone = !open && !rolling;
  const fieldStyle = useAnimatedStyle(() => ({ width: progress.value * (FIELD_WIDTH + FIELD_GAP) }));

  return (
    <View style={styles.row}>
      <Animated.View style={[styles.fieldSlot, fieldStyle, fieldGone && styles.gone]}>
        {/* Uncontrolled on purpose: the native field keeps its own text, keystrokes land in the
            draft ref, and only the Search key hands the term to the screen. */}
        <SunkenTextInput
          ref={fieldRef}
          containerStyle={styles.fieldWrapper}
          defaultValue={value}
          placeholder={placeholder}
          placeholderTextColor={COLORS.TEXT_SECONDARY}
          accessibilityLabel={placeholder}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          numberOfLines={1}
          multiline={false}
          clearButtonMode="while-editing"
          onChangeText={(text) => {
            draft.current = text;
          }}
          onSubmitEditing={() => onChangeText(draft.current)}
          onFocus={() => {
            editedOnce.current = true;
          }}
          onBlur={handleBlur}
          style={styles.fieldInput}
        />
      </Animated.View>
      <GlassButton icon={<Ionicons name="search" size={24} color={COLORS.ACCENT} />} accessibilityLabel={placeholder} onPress={reveal} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  // Anchored to the capsule's edge: the slot grows leftward and the field's left end emerges.
  fieldSlot: {
    overflow: "hidden",
    alignItems: "flex-end",
    justifyContent: "center",
  },
  gone: {
    display: "none",
  },
  fieldWrapper: {
    width: FIELD_WIDTH,
    height: 64,
    marginRight: FIELD_GAP,
  },
  fieldInput: {
    width: "100%",
    flex: 1,
    backgroundColor: "transparent",
    paddingHorizontal: 24,
    fontSize: 24,
    color: COLORS.TEXT_PRIMARY,
  },
});
