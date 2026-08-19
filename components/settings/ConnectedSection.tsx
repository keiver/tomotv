import { settingsStyles } from "./styles";
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
            color="#34C759"
            style={{
              marginTop: Platform.isTV ? 0 : 15,
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
    backgroundColor: "#1C1C1E",
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
  // The CTA is the card's whole bottom half: a full-bleed tinted row, its
  // corners clipped by the section's own radius + overflow: hidden. Focus is
  // a deeper fill of the same red, no border — a border strip reads as a seam
  // on a row this wide.
  switchRow: {
    width: "100%",
    backgroundColor: "rgba(255, 59, 48, 0.12)",
    paddingVertical: Platform.isTV ? 48 : 28,
    alignItems: "center",
    justifyContent: "center",
    // The opaque fill hides the card's bottom inset lip; re-paint it on the row.
    boxShadow: Platform.isTV ? "inset 0 -5px 5px rgba(0,0,0,0.25)" : "inset 0 -3px 3px rgba(0,0,0,0.25)",
  },
  switchRowFocused: {
    backgroundColor: "rgba(255, 59, 48, 0.3)",
  },
  switchText: {
    color: "#FF3B30",
    fontSize: Platform.isTV ? 30 : 17,
    fontWeight: "600",
    textAlign: "center",
  },
  connectedLabel: {
    fontSize: Platform.isTV ? 24 : 14,
    color: "#C4C4C4",
    marginBottom: 2,
  },
  userLabel: {
    marginTop: 5,
  },
  connectedValue: {
    fontSize: Platform.isTV ? 30 : 18,
    color: "#FFFFFF",
    fontWeight: "500",
    marginBottom: 3,
    marginTop: Platform.isTV ? 0 : 15,
  },
});
