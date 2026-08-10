import { FocusableButton } from "@/components/FocusableButton";
import { ServerRow } from "@/components/settings/ServerRow";
import { SunkenTextInput } from "@/components/sunken-text-input";
import { settingsStyles as styles } from "./styles";
import { DEMO_SERVER_STABLE } from "@/services/jellyfinApi";
import { describeSubnet } from "@/services/networkDiscovery";
import type { UseNetworkScanReturn } from "@/hooks/useNetworkScan";
import { SavedServer } from "@/types/jellyfin";
import React, { useState } from "react";
import { Platform, Text, TextInput, View } from "react-native";

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
 *
 * `alreadySavedCount` is how many of the scan's finds are also in the saved
 * list. Those render as saved rows, not as new discoveries, so without this the
 * row would finish a successful scan by reverting to its idle label with
 * nothing else on screen changing — as if the scan had found nothing.
 */
export function scanRowLabels(scan: UseNetworkScanReturn, alreadySavedCount = 0): { name: string; subtitle?: string } {
  if (scan.status === "UNSUPPORTED") {
    // Pressable rather than dead: this is also what a device shows when it was
    // launched before Wi-Fi came up, and that resolves on its own.
    return { name: "Scan Network", subtitle: "No network connection yet" };
  }

  if (scan.status === "SCANNING") {
    const { done, total, phase } = scan.progress;
    if (!total) return { name: "Stop Scanning", subtitle: "Starting…" };
    // The two phases move at very different speeds, and saying which one is
    // running keeps the slower second stage from reading as a hang.
    const detail = phase === "sweep" ? `${done} of ${total} addresses` : `${done} of ${total} that answered`;
    return { name: "Stop Scanning", subtitle: detail };
  }

  if (scan.status === "CANCELLED") {
    // Says nothing about the subnet: a stopped scan is not evidence of anything.
    return { name: "Scan Network", subtitle: scan.found.length ? `Stopped, ${scan.found.length} found` : "Stopped" };
  }

  if (scan.status === "DONE" && scan.found.length === 0) {
    // Names the range actually swept, which is the diagnostic part, and names the
    // other explanation: a denied Local Network permission is indistinguishable
    // from an empty subnet from in here.
    const where = scan.local ? describeSubnet(scan.local.ip, scan.local.netmask) : "this network";
    return { name: "Scan Again", subtitle: `Nothing on ${where}, or local network access is off` };
  }

  if (scan.status === "DONE") {
    const count = scan.found.length;
    const noun = count === 1 ? "server" : "servers";
    // When everything found was already saved, the row is the only place the
    // result can be announced: no new rows appear below it.
    const subtitle = alreadySavedCount >= count ? `Found ${count} ${noun}, already in your list` : `${count} ${noun} found`;
    return { name: "Scan Again", subtitle };
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

  // Discovered servers already in the saved list are shown once, as saved rows.
  const savedUrls = new Set(savedServers.map((server) => server.url));
  const newlyDiscovered = scan.found.filter((server) => !savedUrls.has(server.url));
  const { name: scanName, subtitle: scanSubtitle } = scanRowLabels(scan, scan.found.length - newlyDiscovered.length);

  return (
    <View style={styles.section}>
      {/* Not disabled while UNSUPPORTED: pressing it re-reads the device address,
          which is the way back for a TV that booted before its network did. */}
      <ServerRow variant="scan" name={scanName} subtitle={scanSubtitle} onPress={scanning ? scan.cancel : scan.start} disabled={busy} isLoading={scanning} hasTVPreferredFocus />
      <ServerRow variant="add" name="Add Server" onPress={revealInput} disabled={busy} />

      {/* The two rows above are actions; everything below is a server. */}
      <View style={styles.listDivider} />

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
          <SunkenTextInput
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
