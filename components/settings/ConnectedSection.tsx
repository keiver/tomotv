import { FocusableButton } from "@/components/FocusableButton";
import { settingsStyles } from "./styles";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

interface ConnectedSectionProps {
  serverName: string;
  serverUrl: string;
  userName?: string;
  authMethod?: string;
  onSignOut: () => void;
}

const AUTH_METHOD_LABELS: Record<string, string> = {
  quickconnect: "Quick Connect",
  password: "Password",
  apikey: "API Key",
  demo: "Demo",
};

/**
 * The account line disambiguates multi-user servers (app and web can be signed
 * into different users, which makes per-user rows like Continue Watching look
 * broken). Sessions saved before the username was persisted have neither value,
 * so the line disappears rather than rendering empty.
 */
function accountLine(userName?: string, authMethod?: string): string | null {
  const method = authMethod ? AUTH_METHOD_LABELS[authMethod] : undefined;
  if (userName && method) return `Signed in as ${userName} · ${method}`;
  if (userName) return `Signed in as ${userName}`;
  if (method) return `Signed in via ${method}`;
  return null;
}

export function ConnectedSection({ serverName, serverUrl, userName, authMethod, onSignOut }: ConnectedSectionProps) {
  const account = accountLine(userName, authMethod);
  return (
    <View style={settingsStyles.section}>
      <View style={[settingsStyles.listItem, settingsStyles.listItemFirst]}>
        <View style={styles.connectedRow}>
          <Ionicons name="checkmark-circle" size={Platform.isTV ? 32 : 24} color="#34C759" />
          <View style={styles.connectedInfo}>
            <Text style={styles.connectedLabel}>Connected</Text>
            <Text style={styles.connectedValue}>{serverName}</Text>
            {serverUrl ? <Text style={styles.connectedLabel}>{serverUrl}</Text> : null}
            {account ? <Text style={styles.connectedAccount}>{account}</Text> : null}
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
  // Between value and label in weight: the account decides whether per-user rows
  // (Continue Watching) can be trusted, so it must not fade into the URL line.
  connectedAccount: {
    fontSize: Platform.isTV ? 24 : 14,
    color: "#EBEBF0",
    marginTop: 4,
  },
});
