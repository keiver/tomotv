import { settingsStyles } from "./styles";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

interface ConnectedSectionProps {
  serverName: string;
  serverUrl: string;
  userName?: string;
  onSignOut: () => void;
}

/**
 * The account in the label disambiguates multi-user servers (app and web can be
 * signed into different users, which makes per-user rows like Continue Watching
 * look broken). Sessions saved before the username was persisted fall back to
 * the plain "Connected" label.
 */
export function ConnectedSection({ serverName, serverUrl, userName, onSignOut }: ConnectedSectionProps) {
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
            <Text style={styles.connectedValue}>{userName && serverName ? `${userName} at ${serverName}` : serverName}</Text>
            {serverUrl ? <Text style={styles.connectedLabel}>{serverUrl}</Text> : null}
          </View>
        </View>
      </View>

      <Pressable
        onPress={onSignOut}
        isTVSelectable={true}
        accessibilityRole="button"
        accessibilityLabel="Sign Out"
        // No parallax: a scaled full-bleed row drifts out of the card's clip.
        tvParallaxProperties={{ enabled: false }}
        style={({ focused, pressed }) => [styles.signOutRow, focused && !pressed && styles.signOutRowFocused, pressed && styles.signOutRowPressed]}>
        <Text style={styles.signOutText}>Sign Out</Text>
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
    // Swallows the wrapper row's bottom padding so the Sign Out key sits flush
    // against the tile instead of showing a strip of the card between them.
    marginBottom: Platform.isTV ? -28 : -14,
    // The opaque tile hides the card's top inset lip; re-paint it on the row.
    boxShadow: Platform.isTV ? "inset 0 6px 8px rgba(0,0,0,0.35)" : "inset 0 4px 5px rgba(0,0,0,0.35)",
  },
  connectedInfo: {
    flex: 1,
  },
  // The CTA is the card's whole bottom half, a raised full-bleed piano key:
  // square top edge, bottom corners clipped by the section's own radius +
  // overflow hidden. Opaque molded red face, lit top rim, dark under-edge.
  // Focus lifts and brightens the key plus a red backlight; a press travels it
  // down. All paint lives on the Pressable — tvOS occlusion rule.
  signOutRow: {
    width: "100%",
    backgroundColor: "#6E332E",
    experimental_backgroundImage: "linear-gradient(180deg, #823B36 0%, #6E332E 55%, #582722 100%)",
    paddingVertical: Platform.isTV ? 48 : 28,
    alignItems: "center",
    justifyContent: "center",
    boxShadow: Platform.isTV
      ? "inset 0 3px 2px rgba(255,255,255,0.2), inset 0 -6px 8px rgba(0,0,0,0.4), 0 10px 18px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.4)"
      : "inset 0 2px 1px rgba(255,255,255,0.2), inset 0 -4px 6px rgba(0,0,0,0.4), 0 6px 12px rgba(0,0,0,0.6), 0 3px 5px rgba(0,0,0,0.4)",
  },
  signOutRowFocused: {
    backgroundColor: "#8A3B34",
    experimental_backgroundImage: "linear-gradient(180deg, #A0463D 0%, #8A3B34 55%, #6E2E28 100%)",
    boxShadow: Platform.isTV
      ? "inset 0 3px 2px rgba(255,255,255,0.3), inset 0 -6px 8px rgba(0,0,0,0.45), 0 10px 18px rgba(0,0,0,0.6), 0 4px 8px rgba(0,0,0,0.4), 0 6px 28px rgba(255,59,48,0.3)"
      : "inset 0 2px 1px rgba(255,255,255,0.3), inset 0 -4px 6px rgba(0,0,0,0.45), 0 6px 12px rgba(0,0,0,0.6), 0 3px 5px rgba(0,0,0,0.4), 0 4px 18px rgba(255,59,48,0.3)",
  },
  signOutRowPressed: {
    backgroundColor: "#4A2320",
    experimental_backgroundImage: "linear-gradient(180deg, #3F1E1B 0%, #4A2320 100%)",
    boxShadow: Platform.isTV ? "inset 0 6px 10px rgba(0,0,0,0.55)" : "inset 0 4px 7px rgba(0,0,0,0.55)",
  },
  signOutText: {
    color: "#FF3B30",
    fontSize: Platform.isTV ? 24 : 17,
    fontWeight: "600",
    textAlign: "center",
  },
  connectedLabel: {
    fontSize: Platform.isTV ? 24 : 14,
    color: "#98989D",
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
