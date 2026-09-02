import { glyphSize, LeadingTile, useTileSide } from "@/components/settings/LeadingTile";
import { SERVER_GLYPH } from "@/components/settings/ServerRow";
import { ROW_PADDING_V, settingsStyles } from "./styles";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

interface ConnectedSectionProps {
  serverUrl: string;
  userName?: string;
  /** Opens the pushed server list (switch destination, add one, or sign out from there). */
  onSwitchServer: () => void;
}

/**
 * The account in the label disambiguates multi-user servers (app and web can be
 * signed into different users, which makes per-user rows like Continue Watching
 * look broken). Sessions saved before the username was persisted fall back to
 * the plain "Connected" label.
 */
export function ConnectedSection({ serverUrl, userName, onSwitchServer }: ConnectedSectionProps) {
  const [tileSide, onTileLayout] = useTileSide();
  return (
    <View style={settingsStyles.section}>
      <View style={[settingsStyles.listItem, settingsStyles.listItemFirst]}>
        <View style={styles.connectedRow}>
          <LeadingTile side={tileSide}>
            <Ionicons name={SERVER_GLYPH} size={glyphSize(tileSide)} color={COLORS.SUCCESS} />
          </LeadingTile>
          <View style={styles.connectedInfo} onLayout={onTileLayout}>
            <Text style={styles.connectedValue}>{userName}</Text>
            {serverUrl ? <Text style={styles.connectedLabel}>{serverUrl}</Text> : null}
          </View>
        </View>
      </View>

      <Pressable
        onPress={onSwitchServer}
        isTVSelectable={true}
        accessibilityRole="button"
        accessibilityLabel="Switch Server"
        // No parallax: a scaled full-bleed row drifts out of the card's clip.
        tvParallaxProperties={{ enabled: false }}
        style={({ focused, pressed }) => [styles.switchRow, (focused || pressed) && styles.switchRowFocused]}>
        {({ focused, pressed }) => <Text style={[styles.switchText, (focused || pressed) && styles.switchTextFocused]}>Switch Server</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sunken band across the card's top: bleeds through the wrapper row's padding on
  // every side, then lays the mark and text out on the list rows' own grid, with a
  // step more air above and below than a row gets.
  connectedRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: Platform.isTV ? 16 : 12,
    backgroundColor: COLORS.SURFACE_SUNKEN,
    marginHorizontal: Platform.isTV ? -32 : -20,
    paddingHorizontal: Platform.isTV ? 32 : 20,
    marginVertical: -ROW_PADDING_V,
    paddingVertical: Platform.isTV ? 40 : 22,
    // The opaque band hides the card's top inset lip; re-paint it on the row.
    boxShadow: Platform.isTV ? "inset 0 6px 8px rgba(0,0,0,0.35)" : "inset 0 4px 5px rgba(0,0,0,0.35)",
  },
  connectedInfo: {
    flex: 1,
    justifyContent: "center",
  },
  // The CTA is the card's whole bottom half: a full-bleed row, its corners
  // clipped by the section's own radius + overflow: hidden. Resting is a neutral
  // fill with a gold label; focus and press take the gold fill and ink the
  // section's selected rows wear, no border, a border strip reads as a seam
  // on a row this wide.
  switchRow: {
    width: "100%",
    backgroundColor: COLORS.SURFACE_NEUTRAL,
    paddingVertical: Platform.isTV ? 48 : 28,
    alignItems: "center",
    justifyContent: "center",
    // The opaque fill hides the card's bottom inset lip; re-paint it on the row.
    boxShadow: Platform.isTV ? "inset 0 -5px 5px rgba(0,0,0,0.25)" : "inset 0 -3px 3px rgba(0,0,0,0.25)",
  },
  switchRowFocused: {
    backgroundColor: CARD_FOCUS.TITLE_BG_FOCUSED,
  },
  switchText: {
    color: COLORS.ACCENT,
    fontSize: Platform.isTV ? 30 : 17,
    fontWeight: "600",
    textAlign: "center",
  },
  switchTextFocused: {
    color: CARD_FOCUS.TITLE_TEXT_FOCUSED,
  },
  connectedLabel: {
    fontSize: Platform.isTV ? 24 : 14,
    color: COLORS.TEXT_DIM,
  },
  connectedValue: {
    fontSize: Platform.isTV ? 30 : 18,
    color: COLORS.TEXT_PRIMARY,
    fontWeight: "500",
    marginBottom: 3,
  },
});
