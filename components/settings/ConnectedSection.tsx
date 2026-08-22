import { settingsStyles } from "./styles";
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
  return (
    <View style={settingsStyles.section}>
      <View style={[settingsStyles.listItem, settingsStyles.listItemFirst]}>
        <View style={styles.connectedRow}>
          <Ionicons
            name="server"
            size={Platform.isTV ? 58 : 40}
            color={COLORS.SUCCESS}
            style={{
              marginTop: Platform.isTV ? 0 : 15,
              transform: [{ translateY: 2 }],
            }}
          />
          <View style={styles.connectedInfo}>
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
        <Text style={styles.switchText}>Switch Server</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Sunken tile inside the section card, matching the section's corner radius.
  connectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Platform.isTV ? 20 : 18,
    backgroundColor: COLORS.SURFACE_SUNKEN,
    borderRadius: 0,
    padding: 10,
    paddingLeft: "9%",
    marginTop: Platform.isTV ? -45 : -30,
    paddingTop: "8%",
    paddingBottom: Platform.isTV ? "6%" : "7%",
    marginLeft: "-9%",
    marginRight: "-9%",
    // Swallows the wrapper row's bottom padding so the Sign Out row sits flush
    // against the tile instead of showing a strip of the card between them.
    marginBottom: Platform.isTV ? -28 : -14,
    // The opaque tile hides the card's top inset lip; re-paint it on the row.
    boxShadow: Platform.isTV ? "inset 0 6px 8px rgba(0,0,0,0.35)" : "inset 0 4px 5px rgba(0,0,0,0.35)",
  },
  connectedInfo: {
    flex: 1,
  },
  // The CTA is the card's whole bottom half: a full-bleed row, its corners
  // clipped by the section's own radius + overflow: hidden. Focus lifts the
  // fill a step, no border — a border strip reads as a seam on a row this wide.
  //
  // Neutral fill, gold label: a gold wash at any opacity the row can carry
  // composites to khaki against this card, and a solid gold fill is the app's
  // focused/current mark. Red is gone with it — this row navigates, and Sign
  // Out on that screen is the destructive one.
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
    backgroundColor: COLORS.SURFACE_MUTED,
  },
  switchText: {
    color: COLORS.ACCENT,
    fontSize: Platform.isTV ? 30 : 17,
    fontWeight: "600",
    textAlign: "center",
  },
  connectedLabel: {
    fontSize: Platform.isTV ? 24 : 14,
    color: COLORS.TEXT_DIM,
    marginBottom: 0,
  },
  userLabel: {
    marginTop: 5,
  },
  connectedValue: {
    fontSize: Platform.isTV ? 30 : 18,
    color: COLORS.TEXT_PRIMARY,
    fontWeight: "500",
    marginBottom: 3,
    marginTop: Platform.isTV ? 0 : 15,
  },
});
