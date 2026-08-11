import { ServerRow } from "@/components/settings/ServerRow";
import { settingsStyles } from "./styles";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Platform, StyleSheet, TextInput, View } from "react-native";

interface AddServerRowProps {
  serverUrl: string;
  setServerUrl: (v: string) => void;
  serverUrlRef: React.RefObject<TextInput | null>;
  isValidating: boolean;
  /** Resolve the typed address and advance the login flow. */
  onConnect: () => void;
  disabled?: boolean;
}

/**
 * The Add Server list row, which turns into the address field in place.
 *
 * Both states render the same row: the same padding, the same leading glyph in
 * the same column, and the same trailing slot. Only the label swaps for an
 * input, so nothing above or below it moves and the server list stays put —
 * the row is the entry point AND the field, not a disclosure that pushes the
 * list around or covers it.
 *
 * The height is pinned by listItemContent's minHeight rather than by whichever
 * of the two happens to measure taller, so the swap can't shift by a point.
 */
export function AddServerRow({ serverUrl, setServerUrl, serverUrlRef, isValidating, onConnect, disabled = false }: AddServerRowProps) {
  const [editing, setEditing] = useState(false);

  if (!editing) {
    return <ServerRow variant="add" name="Add Server" onPress={() => setEditing(true)} disabled={disabled} />;
  }

  return (
    <View style={settingsStyles.listItem}>
      <View style={settingsStyles.listItemContent}>
        <View style={styles.left}>
          <Ionicons name="add-circle-outline" size={Platform.isTV ? 32 : 22} color="#FFC312" />
          <TextInput
            ref={serverUrlRef}
            value={serverUrl}
            placeholder="Enter an IP or hostname, or paste a full URL"
            placeholderTextColor="#8E8E93"
            accessibilityLabel="Server address"
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="url"
            onChangeText={setServerUrl}
            style={styles.field}
            // The row's whole point: pressing it hands over an editable field, so
            // the caret is already there.
            autoFocus
            numberOfLines={1}
            multiline={false}
            clearButtonMode="while-editing"
            onSubmitEditing={() => onConnect()}
            returnKeyType="go"
            editable={!isValidating}
            // Give the row back when the field is left empty; text that was typed
            // stays on screen so dismissing the keyboard doesn't discard it.
            onBlur={() => {
              if (!serverUrl.trim() && !isValidating) setEditing(false);
            }}
          />
        </View>
        {/* Same trailing slot as the resting row, so the swap can't nudge the
            left column either. */}
        {isValidating ? <ActivityIndicator color="#FFC312" size="small" style={styles.spinnerInset} /> : <Ionicons name="chevron-forward" size={Platform.isTV ? 28 : 20} color="#8E8E93" />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Mirrors ServerRow's own left column: same direction, flex and gap, so the
  // glyph lands in the same place in both states.
  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: Platform.isTV ? 16 : 12,
  },
  // A step under listItemTitle: an address is longer than a server name and
  // wants the extra characters more than the extra weight. Zero padding keeps
  // the field's box inside the row's pinned height on every OS version.
  field: {
    flex: 1,
    padding: 0,
    fontSize: Platform.isTV ? 28 : 17,
    color: "#FFFFFF",
  },
  spinnerInset: {
    marginRight: Platform.isTV ? 14 : 12,
  },
});
