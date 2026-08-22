import { FocusableButton } from "@/components/FocusableButton";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const ICON = IS_TV ? 30 : 20;
const DIAMETER = IS_TV ? 62 : 44;
/** How long an action report holds the caption before focus takes it back. */
const MESSAGE_MS = 2200;

interface InfoActionRowProps {
  isFavorite: boolean;
  isPlayed: boolean;
  /** Progress was cleared while this panel has been open, so the snapshot is still restorable. */
  cleared: boolean;
  onToggleFavorite: () => void;
  onToggleWatched: () => void;
  /** Omit when the item has nothing to clear — the third circle disappears with it. */
  onToggleProgress?: () => void;
}

/**
 * The panel's secondary actions: three circles of one size, with a caption underneath.
 *
 * The caption is what makes an unlabelled circle legible. On tvOS it names what the focused
 * circle's next press will do; on both platforms a press replaces it with what just happened,
 * which is the only readable confirmation a filled-vs-outline glyph swap has at TV distance.
 */
type ActionKey = "favorite" | "watched" | "progress";

export function InfoActionRow({ isFavorite, isPlayed, cleared, onToggleFavorite, onToggleWatched, onToggleProgress }: InfoActionRowProps) {
  // Which circle holds focus, never the label itself: tvOS fires the outgoing blur AFTER the
  // incoming focus, so a shared string gets wiped by the button focus just left.
  const [focused, setFocused] = useState<ActionKey | null>(null);
  const [message, setMessage] = useState("");
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => (messageTimer.current ? clearTimeout(messageTimer.current) : undefined), []);

  const report = useCallback((text: string) => {
    setMessage(text);
    // The caption is hidden from assistive tech, so the report has to be spoken: a screen
    // reader stays on the button it just pressed and would never reach the text.
    AccessibilityInfo.announceForAccessibility(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(""), MESSAGE_MS);
  }, []);

  const blur = useCallback((key: ActionKey) => setFocused((current) => (current === key ? null : current)), []);

  // Labels state the press, not the noun, so the caption reads the same way the row acts.
  const favoriteLabel = isFavorite ? "Remove favorite" : "Add to favorites";
  const watchedLabel = isPlayed ? "Mark as unwatched" : "Mark as watched";
  const progressLabel = cleared ? "Restore progress" : "Clear progress";
  const focusLabel = focused === "favorite" ? favoriteLabel : focused === "watched" ? watchedLabel : focused === "progress" ? progressLabel : "";

  const press = (run: () => void, done: string) => () => {
    run();
    report(done);
  };

  // The lit fill yields to focus: a custom style is flattened AFTER the focused variant style,
  // so leaving it on would paint over the focus tint and flatten the two states into one.
  const circleStyle = (on: boolean, key: ActionKey) => StyleSheet.flatten([styles.circle, on && focused !== key ? styles.circleOn : null]);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <FocusableButton
          variant="secondary"
          style={circleStyle(isFavorite, "favorite")}
          icon={<Ionicons name={isFavorite ? "heart" : "heart-outline"} size={ICON} color={COLORS.ACCENT} />}
          accessibilityLabel={favoriteLabel}
          accessibilityState={{ selected: isFavorite }}
          onFocus={() => setFocused("favorite")}
          onBlur={() => blur("favorite")}
          onPress={press(onToggleFavorite, isFavorite ? "Removed from favorites" : "Added to favorites")}
        />
        <FocusableButton
          variant="secondary"
          style={circleStyle(isPlayed, "watched")}
          icon={<Ionicons name={isPlayed ? "eye" : "eye-off"} size={ICON} color={COLORS.ACCENT} />}
          accessibilityLabel={watchedLabel}
          accessibilityState={{ selected: isPlayed }}
          onFocus={() => setFocused("watched")}
          onBlur={() => blur("watched")}
          onPress={press(onToggleWatched, isPlayed ? "Marked as unwatched" : "Marked as watched")}
        />
        {!!onToggleProgress && (
          // Not destructive ink: the position is restorable for as long as this panel lives.
          // The glyph carries the state, the way the heart and the eye do.
          <FocusableButton
            variant="secondary"
            style={circleStyle(cleared, "progress")}
            icon={<Ionicons name={cleared ? "arrow-undo" : "git-commit-outline"} size={ICON} color={COLORS.ACCENT} />}
            accessibilityLabel={progressLabel}
            onFocus={() => setFocused("progress")}
            onBlur={() => blur("progress")}
            onPress={press(onToggleProgress, cleared ? "Progress restored" : "Progress cleared")}
          />
        )}
      </View>
      {/* Height is reserved, so the panel never reflows as focus enters and leaves the row. */}
      <Text style={[styles.caption, !!message && styles.captionStatus]} numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        {message || focusLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: "center",
    alignItems: "center",
  },
  row: {
    flexDirection: "row",
    justifyContent: "center",
    gap: IS_TV ? 30 : 24,
  },
  // Sizing only: a custom style is flattened AFTER the focused variant style, so a colour
  // here would eat the focus ring. Square, which the base radius rounds to a circle;
  // minHeight has to be restated or styles.button's CONTROL_HEIGHT floor wins.
  circle: {
    width: DIAMETER,
    height: DIAMETER,
    minWidth: 0,
    minHeight: DIAMETER,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  caption: {
    height: IS_TV ? 30 : 20,
    lineHeight: IS_TV ? 30 : 20,
    marginTop: IS_TV ? 10 : 6,
    fontSize: IS_TV ? 20 : 13,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
  // On, at rest: a wash well under the focus tint's 0.15, so the two never read alike.
  circleOn: {
    backgroundColor: "rgba(255, 195, 18, 0.07)",
  },
  // A report of something that just happened, not the name of what focus is on.
  captionStatus: {
    color: COLORS.SUCCESS,
  },
});
