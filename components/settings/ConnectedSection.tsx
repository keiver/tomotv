import { FocusableButton } from "@/components/FocusableButton";
import { settingsStyles } from "./styles";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

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
          <Ionicons name="server" size={Platform.isTV ? 56 : 40} color="#34C759" />
          <View style={styles.connectedInfo}>
            <Text style={styles.connectedLabel}>{userName ? `${userName}` : "Connected"}</Text>
            <Text style={styles.connectedValue}>{serverName}</Text>
            {serverUrl ? <Text style={styles.connectedLabel}>{serverUrl}</Text> : null}
          </View>
        </View>
      </View>

      <View style={[settingsStyles.listItem, settingsStyles.listItemLast]}>
        <FocusableButton title="Sign Out" variant="destructive" onPress={onSignOut} style={signOutButtonStyle} />
      </View>
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
  },
  connectedInfo: {
    flex: 1,
  },
  // Tinted fill so the button reads as one on phone, where the destructive
  // variant has no focus state to reveal its bounds.
  signOutButton: {
    backgroundColor: "rgba(255, 59, 48, 0.12)",
  },
  connectedLabel: {
    fontSize: Platform.isTV ? 24 : 14,
    color: "#98989D",
    marginBottom: 2,
  },
  connectedValue: {
    fontSize: Platform.isTV ? 30 : 18,
    color: "#FFFFFF",
    fontWeight: "500",
    marginBottom: 3,
  },
});

// FocusableButton takes a single ViewStyle, not an array.
const signOutButtonStyle = StyleSheet.flatten([settingsStyles.fullWidthButton, styles.signOutButton]);
