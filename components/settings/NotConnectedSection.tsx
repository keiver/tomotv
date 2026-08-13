import { AddServerRow } from "@/components/settings/AddServerRow";
import { ServerRow } from "@/components/settings/ServerRow";
import { settingsStyles as styles } from "./styles";
import { DEMO_SERVER_STABLE } from "@/services/jellyfinApi";
import { describeSubnet } from "@/services/networkDiscovery";
import type { UseNetworkScanReturn } from "@/hooks/useNetworkScan";
import { SavedServer } from "@/types/jellyfin";
import React, { useCallback, useRef } from "react";
import { ScrollView, TextInput, View } from "react-native";

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

/** One destination row in the capped list: a discovered server, a saved one, or the demo. */
interface DestinationRow {
  key: string;
  variant: "server" | "demo";
  name: string;
  subtitle?: string;
  onPress: () => void;
  onLongPress?: () => void;
  isLoading: boolean;
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
  const busy = isValidating || isConnectingDemo;
  const scanning = scan.status === "SCANNING";

  // Discovered servers already in the saved list are shown once, as saved rows.
  const savedUrls = new Set(savedServers.map((server) => server.url));
  const newlyDiscovered = scan.found.filter((server) => !savedUrls.has(server.url));
  const { name: scanName, subtitle: scanSubtitle } = scanRowLabels(scan, scan.found.length - newlyDiscovered.length);

  // One list, so the capped scroll below knows which rows are its ends. Discovered first
  // (they are the result of an action just taken), then saved, then demo — demo last because
  // it is the fallback, not a destination anyone came here for.
  const destinations: DestinationRow[] = [
    ...newlyDiscovered.map((server) => ({
      key: server.url,
      variant: "server" as const,
      name: server.name,
      subtitle: server.url,
      onPress: () => onSelectDiscovered(server.url),
      isLoading: connectingServerId === server.url,
    })),
    ...savedServers.map((server) => ({
      key: server.id,
      variant: "server" as const,
      name: server.name,
      onPress: () => onSelectServer(server),
      onLongPress: () => onServerOptions(server),
      isLoading: connectingServerId === server.id,
    })),
    { key: "demo", variant: "demo" as const, name: DEMO_SERVER_STABLE, onPress: onConnectDemo, isLoading: isConnectingDemo },
  ];

  // tvOS can only move focus out of a ScrollView while its offset is at the matching end:
  // RCTScrollViewComponentView's shouldUpdateFocusInContext rejects an upward focus update
  // that leaves a scrolled view, and the same for downward. Landing on the first/last row is
  // the only moment focus can leave, so pin the offset there. Same fix, same reason, as the
  // Video Quality list in app/(tabs)/settings.tsx — where the rows above this scroll (Scan,
  // Add Server) are what Up has to reach.
  const listRef = useRef<ScrollView>(null);
  const pinToTop = useCallback(() => listRef.current?.scrollTo({ y: 0, animated: false }), []);
  const pinToBottom = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  return (
    <View style={styles.section}>
      {/* Not disabled while UNSUPPORTED: pressing it re-reads the device address,
          which is the way back for a TV that booted before its network did.
          Claims no preferred focus: this section also stands in for the Library
          and Search tabs while no server is configured, and taking focus on mount
          drags the user into the form every time they land on one of those tabs. */}
      <ServerRow variant="scan" name={scanName} subtitle={scanSubtitle} onPress={scanning ? scan.cancel : scan.start} disabled={busy} isLoading={scanning} />
      {/* CTA plus the address field parked under it; both stay mounted. */}
      <AddServerRow serverUrl={serverUrl} setServerUrl={setServerUrl} serverUrlRef={serverUrlRef} isValidating={isValidating} onConnect={onConnect} disabled={busy} />

      {/* The two rows above are actions; everything below is a server. */}
      <View style={styles.listDivider} />

      {/* Capped and internally scrolling once the destinations outgrow it, so a scan that
          finds several servers can't push the rest of the screen off the bottom. Under the
          cap the ScrollView just sizes to its rows and nothing scrolls. */}
      {/* keyboardShouldPersistTaps is not inherited from the host's scroll view: without it here,
          a tap on a row while the Add Server field has the keyboard up would be spent dismissing
          the keyboard, and the row would need a second tap. */}
      <ScrollView ref={listRef} style={styles.serverListScrollable} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
        {destinations.map((row, index) => (
          <ServerRow
            key={row.key}
            variant={row.variant}
            name={row.name}
            subtitle={row.subtitle}
            onPress={row.onPress}
            onLongPress={row.onLongPress}
            onFocus={index === 0 ? pinToTop : index === destinations.length - 1 ? pinToBottom : undefined}
            isLoading={row.isLoading}
            disabled={busy}
          />
        ))}
      </ScrollView>
    </View>
  );
}
