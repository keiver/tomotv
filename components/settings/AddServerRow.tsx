import { ServerRow } from "@/components/settings/ServerRow";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { ADD_FIELD_MIN_HEIGHT, ADD_ROW_PADDING_V, ADD_SERVER_ROW_HEIGHT } from "./styles";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useState } from "react";
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
    setOpen(true);
    setRolling(true);
  };

  // Giving up the caret gives the slot back, so an untouched field does not sit
  // there looking like the list is mid-edit. Only when it is empty: a typed
  // address that failed to connect stays on screen to be corrected.
  //
  // Phone only. On tvOS every keyboard dismissal blurs the field, so this would
  // roll the CTA back the moment the user finished typing — and that swap is
  // exactly what sent focus back to the first row in the earlier versions.
  const handleBlur = () => {
    if (IS_TV || serverUrl.trim()) return;
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
          <Ionicons name="add-circle-outline" size={IS_TV ? 32 : 22} color="#FFC312" />
          {/* The Search tab's field: the shared sunken card, gold border on focus.
              It carries a resting outline here that Search does not need, because
              this one sits on the section card rather than on the page. */}
          <SunkenTextInput
            ref={serverUrlRef}
            containerStyle={styles.fieldWrapper}
            value={serverUrl}
            placeholder="Enter your server address"
            placeholderTextColor="#98989D"
            accessibilityLabel="Server address, we detect the protocols automatically"
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="url"
            onChangeText={setServerUrl}
            onBlur={handleBlur}
            style={styles.field}
            numberOfLines={1}
            multiline={false}
            clearButtonMode="while-editing"
            onSubmitEditing={() => onConnect()}
            returnKeyType="go"
            editable={!isValidating && !disabled}
          />
          {isValidating ? <ActivityIndicator color="#FFC312" size="small" /> : null}
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
    paddingHorizontal: IS_TV ? 28 : 16,
    paddingVertical: ADD_ROW_PADDING_V,
    gap: IS_TV ? 16 : 12,
  },
  // Layout only on phone, so the field keeps the shared sunken treatment the rest
  // of the settings inputs use: SunkenTextInput's own #2C2C2E card, inset shadow
  // and gold focus border. Overriding the fill or the resting border here is what
  // flattens it — the sunken read comes from that inset shadow, not from a rim.
  // TV has no wrapper chrome of its own (an overlay above a focusable occludes it
  // on tvOS), so it supplies the outline the same way the Search tab does.
  fieldWrapper: {
    flex: 1,
    width: "auto",
    ...(IS_TV
      ? {
          borderRadius: 28,
          overflow: "hidden" as const,
          borderWidth: 2,
          borderColor: "#3A3A3C",
          backgroundColor: "#2C2C2E",
        }
      : null),
  },
  // Mirrors the Search tab's field metrics.
  field: {
    width: "100%",
    minHeight: ADD_FIELD_MIN_HEIGHT,
    paddingHorizontal: IS_TV ? 28 : 20,
    fontSize: IS_TV ? 28 : 20,
    color: "#FFFFFF",
  },
});
