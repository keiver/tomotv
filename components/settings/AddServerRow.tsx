import { ServerRow } from "@/components/settings/ServerRow";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { ADD_ROW_PADDING_V, ADD_SERVER_ROW_HEIGHT, settingsStyles } from "./styles";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const DURATION = 260;
const EASING = Easing.out(Easing.cubic);
const IS_TV = Platform.isTV;

interface AddServerRowProps {
  serverUrl: string;
  setServerUrl: (v: string) => void;
  serverUrlRef: React.RefObject<TextInput | null>;
  isValidating: boolean;
  /** Resolve the typed address and advance the login flow. */
  onConnect: () => void;
  disabled?: boolean;
}

/**
 * One list slot holding two rows: the Add Server CTA and the address field.
 * Pressing the CTA rolls it down out of the slot while the field drops in from
 * above to take its place, so the field replaces the CTA instead of appearing
 * under it and the list never changes height.
 *
 * The two travel the same way rather than crossing. In a slot one row tall, rows
 * moving in opposite directions have to pass through each other halfway; rolling
 * in the same direction keeps their edges touching and nothing overlaps.
 *
 * Whichever row is out of the slot is `display: none`, not merely clipped. A
 * clipped view is still focusable on tvOS — RCTTVView's canBecomeFocused answers
 * for the view itself, and a focus guide's isTVSelectable does not propagate to
 * its subviews (RCTTVView.m) — so a remote could otherwise walk into an invisible
 * row. Leaving layout is what takes it out of the focus order, and it costs
 * nothing: both rows stay mounted, so the field's ref and the typed address
 * survive the swap in either direction.
 *
 * The travel distance is ADD_SERVER_ROW_HEIGHT, computed from the same constants
 * the row's own padding uses. Nothing is measured: an earlier version waited on
 * an onLayout from a subtree that is hidden until the animation starts, so the
 * measurement never arrived and the CTA did nothing at all.
 */
export function AddServerRow({ serverUrl, setServerUrl, serverUrlRef, isValidating, onConnect, disabled = false }: AddServerRowProps) {
  const [open, setOpen] = useState(false);
  // True only while the roll is in flight, when both rows have to be on screen.
  const [rolling, setRolling] = useState(false);
  // Whether the field has held the caret since this reveal, so a blur that
  // precedes its first focus can't be read as the user leaving.
  const editedOnce = useRef(false);

  const progress = useSharedValue(0);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const settle = () => {
      setRolling(false);
      if (open) serverUrlRef.current?.focus();
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

  // Giving up the caret gives the slot back, so an untouched field does not sit
  // there looking like the list is mid-edit. Only when it is empty: a typed
  // address that failed to connect stays on screen to be corrected.
  //
  // Gated on having actually held the caret. The field is focused programmatically
  // the moment the roll settles, and a blur that arrives before its editing
  // session ever began would otherwise bounce the slot straight back to the CTA.
  // Nothing here claims focus as the CTA takes the slot back. A blur usually
  // means the user steered somewhere else on purpose, including up to the tab
  // bar, and pulling focus into this row would drag them back out of wherever
  // they went.
  const handleBlur = () => {
    if (!editedOnce.current || serverUrl.trim()) return;
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
        <ServerRow variant="add" name="Add Server" onPress={reveal} disabled={disabled} />
      </Animated.View>

      <Animated.View style={[styles.layer, fieldStyle, fieldGone && styles.gone]}>
        <View style={styles.fieldRow}>
          <Ionicons name="add-circle-outline" size={IS_TV ? 32 : 22} color={COLORS.ACCENT} />
          {/* The same shared sunken field the login inputs and the Search tab use;
              this call site adds layout only. */}
          <SunkenTextInput
            ref={serverUrlRef}
            containerStyle={styles.fieldWrapper}
            value={serverUrl}
            placeholder="Enter your server address"
            placeholderTextColor={COLORS.TEXT_SECONDARY}
            accessibilityLabel="Server address, we detect the protocols automatically"
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="url"
            onChangeText={setServerUrl}
            onFocus={() => {
              editedOnce.current = true;
            }}
            onBlur={handleBlur}
            style={settingsStyles.textInput}
            numberOfLines={1}
            multiline={false}
            clearButtonMode="while-editing"
            onSubmitEditing={() => onConnect()}
            returnKeyType="go"
            editable={!isValidating && !disabled}
          />
          {isValidating ? <ActivityIndicator color={COLORS.ACCENT} size="small" /> : null}
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Fixed at one slot: the swap happens inside it, so the rows below never move.
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
  // Same horizontal padding and leading gap as ServerRow, so the glyph does not
  // jump as one row replaces the other.
  fieldRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: IS_TV ? 32 : 20,
    paddingVertical: ADD_ROW_PADDING_V,
    gap: IS_TV ? 16 : 12,
  },
  // Layout only. The card, the inset shadow and the gold focus border all come
  // from SunkenTextInput now, on both platforms, so overriding the fill or the
  // resting border here would only flatten it: the sunken read is that shadow,
  // not a rim. maxWidth pulls the field just off the row's right edge on TV,
  // where at full width it read as the row's background rather than a field.
  fieldWrapper: {
    flex: 1,
    width: "auto",
    ...(IS_TV ? { maxWidth: "97%" as const } : null),
  },
});
