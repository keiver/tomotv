import { FocusableButton } from "@/components/FocusableButton";
import { ServerRow } from "@/components/settings/ServerRow";
import { settingsStyles as styles } from "./styles";
import { DEMO_SERVER_STABLE } from "@/services/jellyfinApi";
import { SavedServer } from "@/types/jellyfin";
import React, { useState } from "react";
import { Text, TextInput, View } from "react-native";

interface NotConnectedSectionProps {
  serverUrl: string;
  setServerUrl: (v: string) => void;
  serverUrlRef: React.RefObject<TextInput | null>;
  isValidating: boolean;
  isConnectingDemo: boolean;
  onConnect: () => void;
  onConnectDemo: () => void;
  /** Locally persisted server destinations, most-recent first. */
  savedServers: SavedServer[];
  /** Id of the saved server currently connecting, to show its spinner. */
  connectingServerId: string | null;
  /** Prefill the address and run the login flow for a saved server. */
  onSelectServer: (server: SavedServer) => void;
  /** Open the edit/remove menu for a saved server (long-press). */
  onServerOptions: (server: SavedServer) => void;
}

export function NotConnectedSection({
  serverUrl,
  setServerUrl,
  serverUrlRef,
  isValidating,
  isConnectingDemo,
  onConnect,
  onConnectDemo,
  savedServers,
  connectingServerId,
  onSelectServer,
  onServerOptions,
}: NotConnectedSectionProps) {
  const [showInput, setShowInput] = useState(false);
  const busy = isValidating || isConnectingDemo;

  const revealInput = () => {
    setShowInput(true);
    // Focus runs after the input mounts.
    setTimeout(() => serverUrlRef.current?.focus(), 0);
  };

  return (
    <View style={styles.section}>
      <ServerRow variant="add" name="Add Server" onPress={revealInput} disabled={busy} hasTVPreferredFocus />

      {savedServers.map((server) => (
        <ServerRow
          key={server.id}
          variant="server"
          name={server.name}
          onPress={() => onSelectServer(server)}
          onLongPress={() => onServerOptions(server)}
          isLoading={connectingServerId === server.id}
          disabled={busy}
        />
      ))}

      <ServerRow variant="demo" name={DEMO_SERVER_STABLE} onPress={onConnectDemo} isLoading={isConnectingDemo} disabled={busy} />

      {showInput && (
        <View style={[styles.listItem, styles.inputContainer]}>
          <Text style={styles.inputLabel}>Connect to:</Text>
          <TextInput
            ref={serverUrlRef}
            value={serverUrl}
            placeholder="Enter an IP or hostname, or paste a full URL"
            placeholderTextColor="#98989D"
            accessibilityLabel="Server address"
            autoCorrect={false}
            autoCapitalize="none"
            keyboardType="url"
            onChangeText={setServerUrl}
            style={styles.textInput}
            autoFocus={false}
            numberOfLines={1}
            multiline={false}
            onSubmitEditing={() => onConnect()}
            returnKeyType="go"
          />
          <View style={styles.buttonGroup}>
            <FocusableButton title="Connect" variant="primary" onPress={() => onConnect()} disabled={busy} isLoading={isValidating} style={styles.fullWidthButton} />
            <FocusableButton title="Cancel" variant="secondary" onPress={() => setShowInput(false)} disabled={busy} style={styles.fullWidthButton} />
          </View>
        </View>
      )}
    </View>
  );
}
