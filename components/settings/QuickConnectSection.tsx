import { FocusableButton } from "@/components/FocusableButton";
import { QuickConnectCode } from "@/components/settings/QuickConnectCode";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Clipboard, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { settingsStyles } from "./styles";

const COPIED_MS = 1600;

interface QuickConnectSectionProps {
  code: string | null;
  status: string;
  error: string | null;
  onCancel: () => void;
  onSwitchToPassword: () => void;
}

export function QuickConnectSection({ code, status, error, onCancel, onSwitchToPassword }: QuickConnectSectionProps) {
  // Read the code digit-by-digit with context when it appears
  const spokenCode = code ? code.split("").join(" ") : "";
  useEffect(() => {
    if (status === "SHOWING_CODE" && spokenCode) {
      AccessibilityInfo.announceForAccessibility(`Quick Connect code: ${spokenCode}. Enter it on your server.`);
    }
  }, [status, spokenCode]);

  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const handleCopy = () => {
    if (!code) return;
    Clipboard.setString(code);
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const canCopy = !Platform.isTV && status === "SHOWING_CODE" && !!code;

  const cardContent = (
    <>
      {status === "INITIATING" && (
        <View style={styles.centeredContent}>
          <ActivityIndicator size="large" color="#FFC312" />
          <Text style={styles.statusText}>Starting Quick Connect...</Text>
        </View>
      )}

      {status === "SHOWING_CODE" && code && (
        <View style={styles.centeredContent}>
          <QuickConnectCode code={code} spokenCode={spokenCode} />
        </View>
      )}

      {/* Absolute so the confirmation never nudges the dead-centered code. */}
      {copied && (
        <Text style={styles.copiedCaption} importantForAccessibility="no">
          Copied
        </Text>
      )}

      {status === "ERROR" && (
        <View style={styles.centeredContent}>
          <Ionicons name="alert-circle" size={Platform.isTV ? 48 : 36} color="#FF3B30" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}
    </>
  );

  const cardStyle = [settingsStyles.listItem, settingsStyles.listItemFirst, settingsStyles.listItemLast, styles.quickConnectContainer];

  return (
    <>
      <View style={settingsStyles.section}>
        {/* The whole card is the copy target on touch platforms; TV keeps a plain view so
            nothing here competes with the focus engine. */}
        {canCopy ? (
          <Pressable
            style={cardStyle}
            onPress={handleCopy}
            accessibilityRole="button"
            accessibilityLabel={`Quick Connect code: ${spokenCode}`}
            accessibilityHint="Copies the code, then paste it in your server's Quick Connect section">
            {cardContent}
          </Pressable>
        ) : (
          <View style={cardStyle}>{cardContent}</View>
        )}
        <View style={settingsStyles.sectionInnerShadow} />
      </View>

      <View style={settingsStyles.buttonGroup}>
        <FocusableButton title="Cancel" variant="secondary" onPress={onCancel} style={settingsStyles.fullWidthButton} />
        <FocusableButton title="Use Username & Password" variant="debug" onPress={onSwitchToPassword} style={settingsStyles.fullWidthButton} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  quickConnectContainer: {
    minHeight: Platform.isTV ? 280 : 200,
    justifyContent: "center",
  },
  centeredContent: {
    alignItems: "center",
    justifyContent: "center",
    gap: Platform.isTV ? 20 : 14,
  },
  copiedCaption: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    fontSize: 13,
    fontWeight: "600",
    color: "#98989D",
  },
  statusText: {
    fontSize: Platform.isTV ? 28 : 17,
    color: "#98989D",
    marginTop: Platform.isTV ? 12 : 8,
  },
  errorText: {
    fontSize: Platform.isTV ? 28 : 17,
    // Lighter red than #FF3B30: needs 4.5:1 on the #2C2C2E card behind it
    color: "#FF6961",
    textAlign: "center",
    paddingHorizontal: Platform.isTV ? 24 : 16,
  },
});
