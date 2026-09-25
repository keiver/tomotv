import { ListRow } from "@/components/settings/ListRow";
import { ADD_ROW_PADDING_V, ADD_SERVER_ROW_HEIGHT, settingsStyles } from "@/components/settings/styles";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { COLORS } from "@/constants/colors";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Platform, StyleSheet, TextInput, View } from "react-native";
import Animated, { Easing, runOnJS, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";

const DURATION = 260;
const EASING = Easing.out(Easing.cubic);
const IS_TV = Platform.isTV;
const GLYPH: keyof typeof Ionicons.glyphMap = "calendar-outline";

interface GuideUrlRowProps {
  value: string;
  onChangeText: (v: string) => void;
  /** Persist the typed URL; called as the field gives up the caret. */
  onSave: () => void;
}

/**
 * The external guide URL in one list slot, AddServerRow's roll: the row rolls
 * down out of the slot while the field drops in from above to take its place.
 * Whichever is out of the slot leaves layout (`display: none`), never merely
 * clipped: a clipped view is still focusable on tvOS.
 */
export function GuideUrlRow({ value, onChangeText, onSave }: GuideUrlRowProps) {
  const [open, setOpen] = useState(false);
  // True only while the roll is in flight, when both rows have to be on screen.
  const [rolling, setRolling] = useState(false);
  // Whether the field has held the caret since this reveal, so a blur that
  // precedes its first focus can't be read as the user leaving.
  const editedOnce = useRef(false);
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

  // Giving up the caret saves and gives the slot back; the row's subtitle then
  // shows the saved URL. Gated on having actually held the caret: the field is
  // focused programmatically the moment the roll settles.
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
        <ListRow icon={GLYPH} title={t("liveTv.guideUrl")} subtitle={value.trim() || t("liveTv.guideUrlHint")} onPress={reveal} isLast />
      </Animated.View>

      <Animated.View style={[styles.layer, fieldStyle, fieldGone && styles.gone]}>
        <View style={styles.fieldRow}>
          <Ionicons name={GLYPH} size={IS_TV ? 32 : 22} color={COLORS.ACCENT} />
          {/* The same shared sunken field the login inputs use; this call site adds layout only. */}
          <SunkenTextInput
            ref={fieldRef}
            containerStyle={styles.fieldWrapper}
            value={value}
            placeholder={t("liveTv.guideUrl")}
            placeholderTextColor={COLORS.TEXT_SECONDARY}
            accessibilityLabel={t("liveTv.guideUrlHint")}
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="url"
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
}

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
