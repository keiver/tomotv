import { FocusableButton } from "@/components/FocusableButton";
import { settingsStyles } from "./styles";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, TextInput, View } from "react-native";

interface UsernamePasswordSectionProps {
  username: string;
  setUsername: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  usernameRef: React.RefObject<TextInput | null>;
  passwordRef: React.RefObject<TextInput | null>;
  isSigningIn: boolean;
  onSignIn: () => void;
  onBack: () => void;
  onSwitchToQuickConnect: () => void;
  serverName: string;
}

export function UsernamePasswordSection({
  username,
  setUsername,
  password,
  setPassword,
  usernameRef,
  passwordRef,
  isSigningIn,
  onSignIn,
  onBack,
  onSwitchToQuickConnect,
  serverName,
}: UsernamePasswordSectionProps) {
  return (
    <>
      <View style={settingsStyles.section}>
        {serverName ? (
          <View style={[settingsStyles.listItem, settingsStyles.listItemFirst]}>
            <View style={styles.serverBadge}>
              <Ionicons name="server" size={Platform.isTV ? 24 : 18} color="#34C759" />
              <Text style={styles.serverBadgeText}>{serverName}</Text>
            </View>
          </View>
        ) : null}

        <View style={[settingsStyles.listItem, !serverName && settingsStyles.listItemFirst]}>
          <View style={settingsStyles.inputContainer}>
            <Text style={settingsStyles.inputLabel}>Username</Text>
            <TextInput
              ref={usernameRef}
              value={username}
              placeholder="Enter your username"
              placeholderTextColor="#98989D"
              accessibilityLabel="Username"
              autoCorrect={false}
              autoCapitalize="none"
              onChangeText={setUsername}
              style={settingsStyles.textInput}
              autoFocus={false}
              numberOfLines={1}
              multiline={false}
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
            />
          </View>
        </View>

        <View style={[settingsStyles.listItem, settingsStyles.listItemLast]}>
          <View style={settingsStyles.inputContainer}>
            <Text style={settingsStyles.inputLabel}>Password</Text>
            <TextInput
              ref={passwordRef}
              value={password}
              placeholder="Enter your password"
              placeholderTextColor="#98989D"
              accessibilityLabel="Password"
              autoCorrect={false}
              autoCapitalize="none"
              secureTextEntry={true}
              onChangeText={setPassword}
              style={settingsStyles.textInput}
              autoFocus={false}
              numberOfLines={1}
              multiline={false}
              returnKeyType="go"
              onSubmitEditing={onSignIn}
            />
          </View>
        </View>
      </View>

      <View style={settingsStyles.buttonGroup}>
        <FocusableButton title="Sign In" variant="primary" onPress={onSignIn} disabled={isSigningIn} isLoading={isSigningIn} style={settingsStyles.fullWidthButton} />
        <FocusableButton title="Use Quick Connect Instead" variant="debug" onPress={onSwitchToQuickConnect} disabled={isSigningIn} style={settingsStyles.fullWidthButton} />
        <FocusableButton title="Back" variant="secondary" onPress={onBack} disabled={isSigningIn} style={settingsStyles.fullWidthButton} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  serverBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: Platform.isTV ? 12 : 8,
  },
  serverBadgeText: {
    fontSize: Platform.isTV ? 28 : 17,
    color: "#34C759",
    fontWeight: "500",
  },
});
