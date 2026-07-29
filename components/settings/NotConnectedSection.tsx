import { FocusableButton } from "@/components/FocusableButton";
import { ServerRow } from "@/components/settings/ServerRow";
import { settingsStyles as styles } from "./styles";
import { DEMO_SERVER_STABLE } from "@/services/jellyfinApi";
import { describeSubnet } from "@/services/networkDiscovery";
import type { UseNetworkScanReturn } from "@/hooks/useNetworkScan";
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
  /** Local-subnet scan state and controls. */
  scan: UseNetworkScanReturn;
  /** Run the login flow for a server found by the scan. */
  onSelectDiscovered: (url: string) => void;
}

/**
 * Label and secondary line for the scan row, per scan state.
 *
 * The subtitle is one truncating line, so it stays a short factual fragment.
 * Anything instructional belongs in the label, which is why the row renames
 * itself to the action it performs rather than explaining itself in the margin.
 */
function scanRowLabels(scan: UseNetworkScanReturn): { name: string; subtitle?: string } {
  if (scan.status === "UNSUPPORTED") {
    return { name: "Scan Network", subtitle: "Not available on this device" };
  }
  if (scan.status === "SCANNING") {
    const total = scan.progress.total;
    return { name: "Stop Scanning", subtitle: total ? `${scan.progress.done} of ${total}` : "Starting…" };
  }
  if (scan.status === "DONE" && scan.found.length === 0) {
    // Names the range actually swept, which is the diagnostic part. A denied
    // Local Network permission is indistinguishable from an empty subnet here,
    // so the label offers a retry instead of declaring nothing is there.
    const where = scan.local ? describeSubnet(scan.local.ip, scan.local.netmask) : "this network";
    return { name: "Scan Again", subtitle: `No servers found on ${where}` };
  }
  return { name: "Scan Network", subtitle: scan.local ? `Find servers from ${scan.local.ip}` : undefined };
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
  scan,
  onSelectDiscovered,
}: NotConnectedSectionProps) {
  const [showInput, setShowInput] = useState(false);
  const busy = isValidating || isConnectingDemo;

  const revealInput = () => {
    setShowInput(true);
    // Focus runs after the input mounts.
    setTimeout(() => serverUrlRef.current?.focus(), 0);
  };

  const scanning = scan.status === "SCANNING";
  const { name: scanName, subtitle: scanSubtitle } = scanRowLabels(scan);

  // Discovered servers already in the saved list are shown once, as saved rows.
  const savedUrls = new Set(savedServers.map((server) => server.url));
  const newlyDiscovered = scan.found.filter((server) => !savedUrls.has(server.url));

  return (
    <View style={styles.section}>
      <ServerRow variant="add" name="Add Server" onPress={revealInput} disabled={busy} hasTVPreferredFocus />

      <ServerRow variant="scan" name={scanName} subtitle={scanSubtitle} onPress={scanning ? scan.cancel : scan.start} disabled={busy || scan.status === "UNSUPPORTED"} isLoading={scanning} />

      {newlyDiscovered.map((server) => (
        <ServerRow
          key={server.url}
          variant="server"
          name={server.name}
          subtitle={server.url}
          onPress={() => onSelectDiscovered(server.url)}
          isLoading={connectingServerId === server.url}
          disabled={busy}
        />
      ))}

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
