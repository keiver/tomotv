import { settingsStyles } from "./styles";
import { CARD_FOCUS } from "@/constants/app";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

/** Ink for glyphs sitting on the focused row's gold. */
const INK = CARD_FOCUS.TITLE_TEXT_FOCUSED;

type ServerRowVariant = "add" | "server" | "demo" | "scan";

const ICONS: Record<ServerRowVariant, keyof typeof Ionicons.glyphMap> = {
  add: "add-circle-outline",
  server: "server-outline",
  demo: "server-outline",
  scan: "wifi-outline",
};

interface ServerRowProps {
  variant: ServerRowVariant;
  /** Row label (server name, or the CTA label for the add variant). */
  name: string;
  /** Secondary line under the label (server URL, scan progress, this device's IP). */
  subtitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
  isLoading?: boolean;
  disabled?: boolean;
  /** Marks a server the scan just found that is not in the saved list. */
  isNew?: boolean;
  hasTVPreferredFocus?: boolean;
  /**
   * tvOS focus arrival. Only used by rows at the ends of a capped, internally-scrolling list,
   * which pin the scroll offset so focus can leave it — see NotConnectedSection.
   */
  onFocus?: () => void;
}

/**
 * ServerRow - A full-width list row with a small leading icon, so server names
 * read in full. Used for the add CTA, the network scan, and each saved,
 * discovered, or demo server destination.
 */
export function ServerRow({ variant, name, subtitle, onPress, onLongPress, isLoading = false, disabled = false, isNew = false, hasTVPreferredFocus = false, onFocus }: ServerRowProps) {
  // Only the scan row is stoppable. Discovered and saved rows also spin while
  // they connect, and offering to cancel those would be a lie.
  const stoppable = variant === "scan" && isLoading;
  // The leading glyph carries the action: a spinner alone reads as "wait", so
  // while a scan runs the row's own icon becomes the stop it already performs.
  const iconName = stoppable ? "close-circle" : ICONS[variant];

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      onFocus={onFocus}
      // Pressability follows `disabled` alone. `isLoading` only drives the spinner,
      // so a row that doubles as a stop control (the network scan) stays selectable
      // while it works. Rows that must not be pressed twice already set `disabled`.
      disabled={disabled}
      isTVSelectable={!disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityLabel={[name, isNew ? "new server" : undefined, subtitle].filter(Boolean).join(", ")}
      accessibilityRole="button"
      accessibilityHint={stoppable ? "Stops the network scan" : undefined}
      accessibilityState={{ disabled, busy: isLoading }}
      // No magnification: a scaled focused row drifts its icon and chevron out of
      // column alignment with its neighbors. The background tint carries focus.
      tvParallaxProperties={{ enabled: false }}
      style={({ focused, pressed }) => [settingsStyles.listItem, (focused || pressed) && settingsStyles.listItemFocused, disabled && styles.rowDisabled]}>
      {({ focused, pressed }) => {
        // Every mark on the row is gold at rest, so on the gold fill they all take the bar's ink.
        const onGold = focused || pressed;
        const ink = onGold ? INK : "#FFC312";
        return (
          <View style={settingsStyles.listItemContent}>
            <View style={styles.left}>
              <Ionicons name={iconName} size={Platform.isTV ? 32 : 22} color={ink} />
              <View style={styles.labels}>
                <Text style={[settingsStyles.listItemTitle, onGold && settingsStyles.listItemTitleFocused]} numberOfLines={1}>
                  {name}
                </Text>
                {subtitle ? (
                  <Text style={[settingsStyles.listItemSubtitle, styles.subtitle, onGold && settingsStyles.listItemSubtitleFocused]} numberOfLines={1}>
                    {/* Text-driven like the rest of the row: the word in the accent color is the badge. */}
                    {isNew ? <Text style={{ color: ink }}>New · </Text> : null}
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
            {isLoading ? (
              <ActivityIndicator color={ink} size="small" style={styles.spinnerInset} />
            ) : (
              <Ionicons name="chevron-forward" size={Platform.isTV ? 28 : 20} color={onGold ? INK : "#8E8E93"} />
            )}
          </View>
        );
      }}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Platform.isTV ? 16 : 12,
  },
  labels: {
    flex: 1,
  },
  // The shared listItemSubtitle sits almost at title size, which reads as two
  // competing lines when stacked in a row. Drop it a step and give it room.
  subtitle: {
    fontSize: Platform.isTV ? 22 : 14,
    marginTop: Platform.isTV ? 4 : 1,
  },
  // A spinner sits narrower than the chevron it replaces, so it needs the inset
  // to keep the row's right edge steady.
  spinnerInset: {
    marginRight: Platform.isTV ? 14 : 12,
  },
  rowDisabled: {
    opacity: 0.5,
  },
});
