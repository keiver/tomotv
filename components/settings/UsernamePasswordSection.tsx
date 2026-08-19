import { FocusableButton } from "@/components/FocusableButton";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { settingsStyles } from "./styles";
import React from "react";
import { Platform, Text, TextInput, View } from "react-native";

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
}

export function UsernamePasswordSection({ username, setUsername, password, setPassword, usernameRef, passwordRef, isSigningIn, onSignIn, onBack }: UsernamePasswordSectionProps) {
  return (
    <>
      <View style={[settingsStyles.section, settingsStyles.formCard]}>
        {/* No server badge: the screen header names the server (app/connect/login.tsx). */}
        <View style={settingsStyles.formRow}>
          <View style={settingsStyles.inputContainer}>
            <Text style={settingsStyles.inputLabel}>Username</Text>
            <SunkenTextInput
              ref={usernameRef}
              value={username}
              // Placeholders show the SHAPE of the answer; the label already says which field
              // this is, so repeating it there tells the viewer nothing.
              placeholder="Ex. demo"
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

        <View style={settingsStyles.formRow}>
          <View style={settingsStyles.inputContainer}>
            <Text style={settingsStyles.inputLabel}>Password</Text>
            <SunkenTextInput
              ref={passwordRef}
              value={password}
              placeholder="••••••••"
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

        {/* The CTA sits INSIDE the card, on the same row rhythm as the fields it submits
            (formRow's own padding is the gap), rather than floating under it as a section
            of its own. Same width as the outline pill on the Quick Connect step. */}
        <View style={settingsStyles.formRow}>
          <FocusableButton title="Sign In" variant="primary" onPress={onSignIn} disabled={isSigningIn} isLoading={isSigningIn} style={settingsStyles.fullWidthButton} />
        </View>
      </View>

      {/* Sign In is the only action on this screen. Phone: Back is the nav bar's back
          button (app/_layout.tsx), so nothing is left under the card. */}
      {Platform.isTV && (
        <View style={settingsStyles.secondaryActions}>
          <FocusableButton title="Back" variant="link" onPress={onBack} disabled={isSigningIn} />
        </View>
      )}
    </>
  );
}
