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
          <Ionicons name="checkmark-circle" size={Platform.isTV ? 32 : 24} color="#34C759" />
          <View style={styles.connectedInfo}>
            <Text style={styles.connectedLabel}>{userName ? `${userName}` : "Connected"}</Text>
            <Text style={styles.connectedValue}>{serverName}</Text>
            {serverUrl ? <Text style={styles.connectedLabel}>{serverUrl}</Text> : null}
          </View>
        </View>
      </View>

      <View style={[settingsStyles.listItem, settingsStyles.listItemLast]}>
        <FocusableButton title="Sign Out" variant="destructive" onPress={onSignOut} style={settingsStyles.fullWidthButton} />
      </View>
      <View style={settingsStyles.sectionInnerShadow} />
    </View>
  );
}

const styles = StyleSheet.create({
  connectedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: Platform.isTV ? 16 : 12,
  },
  connectedInfo: {
    flex: 1,
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
  },
});
