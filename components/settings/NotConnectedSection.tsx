import { AddServerRow } from "@/components/settings/AddServerRow";
import { ServerRow } from "@/components/settings/ServerRow";
import { settingsStyles as styles } from "./styles";
import { DEMO_SERVER_STABLE, DEMO_USERNAME } from "@/services/jellyfinApi";
import { describeSubnet } from "@/services/networkDiscovery";
import type { UseNetworkScanReturn } from "@/hooks/useNetworkScan";
import { SavedServer } from "@/types/jellyfin";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Platform, ScrollView, TextInput, View } from "react-native";

const IS_TV = Platform.isTV;

/** Where the app is signed in right now, so that row can wear the checkmark. */
export interface ConnectedDestination {
  serverId: string | null;
  url: string;
  demo: boolean;
}

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
  /** The active session's server, null while signed out. */
  connected?: ConnectedDestination | null;
  /** Per-card pills: the saved sign-ins that can reconnect without a login. */
  savedServerAccounts?: Record<string, string[]>;
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
    // When everything found was already saved, the row is the only place the
    // result can be announced: no new rows appear below it.
    if (alreadySavedCount >= count) {
      const noun = count === 1 ? "server" : "servers";
      return { name: "Scan Again", subtitle: `Found ${count} ${noun}, already in your list` };
    }
    // Counts only the new finds, matching the "New" marks on the rows below.
    const newCount = count - alreadySavedCount;
    const noun = newCount === 1 ? "server" : "servers";
    return { name: "Scan Again", subtitle: `${newCount} new ${noun} found` };
  }

  return { name: "Scan Network", subtitle: scan.local ? `Find servers from ${scan.local.ip}` : undefined };
}

/**
 * Whether a row is the live session. Both sides with an Id compare by Id, so a moved address
 * still matches and a reused one does not; the url decides only when either side has no Id.
 * The demo session matches no server row, only the demo row.
 */
export function isConnectedDestination(connected: ConnectedDestination | null, serverId: string | undefined, url: string): boolean {
  if (connected === null || connected.demo) return false;
  if (serverId && connected.serverId) return serverId === connected.serverId;
  return url === connected.url;
}

/** One destination row in the capped list: a discovered server, a saved one, or the demo. */
interface DestinationRow {
  key: string;
  variant: "server" | "demo";
  name: string;
  subtitle?: string;
  accounts?: string[];
  onPress: () => void;
  onLongPress?: () => void;
  isLoading: boolean;
  isNew?: boolean;
  connected?: boolean;
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
  connected = null,
  savedServerAccounts,
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

  // The first server a scan finds takes focus, whichever row it lands on: a saved
  // card carries no mark of its own, so without this "already in your list" names
  // nothing. Touch has no focus, so there the row holds the gold fill instead and
  // gives it up when another control in the section is used, as focus would.
  const firstFound = scan.found[0];
  const firstFoundKey = firstFound ? (savedServers.find((server) => server.url === firstFound.url)?.id ?? firstFound.url) : null;
  const firstFoundRef = useRef<View>(null);
  // Fires on the null-to-found transition only, so a section mounted after the scan
  // (this widget also stands in for the Library and Search tabs) never yanks focus.
  const previousFirstFoundKey = useRef(firstFoundKey);
  useEffect(() => {
    const previous = previousFirstFoundKey.current;
    previousFirstFoundKey.current = firstFoundKey;
    if (!IS_TV || previous !== null || firstFoundKey === null) return;
    const node = firstFoundRef.current as unknown as { requestTVFocus?: () => void } | null;
    node?.requestTVFocus?.();
  }, [firstFoundKey]);
  // The touch side of the same transition, kept as state so a control can release it.
  const [seenFirstFoundKey, setSeenFirstFoundKey] = useState(firstFoundKey);
  const [heldKey, setHeldKey] = useState<string | null>(null);
  if (seenFirstFoundKey !== firstFoundKey) {
    setSeenFirstFoundKey(firstFoundKey);
    if (!IS_TV && seenFirstFoundKey === null) setHeldKey(firstFoundKey);
  }
  // Using any control but the held row itself takes the fill off it; pressing the
  // held row keeps it, the way focus stays on the row that was pressed.
  const releasing =
    <A extends unknown[]>(fn: (...args: A) => void, key?: string) =>
    (...args: A) => {
      if (key !== heldKey) setHeldKey(null);
      fn(...args);
    };

  // One list, so the capped scroll below knows which rows are its ends. Discovered first
  // (they are the result of an action just taken), then saved, then demo — demo last because
  // it is the fallback, not a destination anyone came here for.
  const isConnected = (serverId: string | undefined, url: string) => isConnectedDestination(connected, serverId, url);
  const destinations: DestinationRow[] = [
    ...newlyDiscovered.map((server) => ({
      key: server.url,
      variant: "server" as const,
      name: server.name,
      subtitle: server.url,
      onPress: () => onSelectDiscovered(server.url),
      isLoading: connectingServerId === server.url,
      isNew: true,
      connected: isConnected(server.id, server.url),
    })),
    ...savedServers.map((server) => ({
      key: server.id,
      variant: "server" as const,
      // Titled by the address as saved, scheme and port included; the saved sign-ins are the
      // only second line, and only when there are some.
      name: server.url,
      accounts: savedServerAccounts?.[server.id],
      onPress: () => onSelectServer(server),
      onLongPress: () => onServerOptions(server),
      isLoading: connectingServerId === server.id,
      connected: isConnected(server.serverId, server.url),
    })),
    { key: "demo", variant: "demo" as const, name: DEMO_SERVER_STABLE, accounts: [DEMO_USERNAME], onPress: onConnectDemo, isLoading: isConnectingDemo, connected: connected?.demo === true },
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
      <ServerRow variant="scan" name={scanName} subtitle={scanSubtitle} onPress={releasing(scanning ? scan.cancel : scan.start)} disabled={busy} isLoading={scanning} />
      {/* CTA plus the address field parked under it; both stay mounted. */}
      <AddServerRow
        serverUrl={serverUrl}
        setServerUrl={releasing(setServerUrl)}
        serverUrlRef={serverUrlRef}
        isValidating={isValidating}
        onReveal={releasing(() => undefined)}
        onConnect={releasing(onConnect)}
        disabled={busy}
      />

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
            ref={row.key === firstFoundKey ? firstFoundRef : undefined}
            selected={row.key === heldKey}
            variant={row.variant}
            name={row.name}
            subtitle={row.subtitle}
            accounts={row.accounts}
            onPress={releasing(row.onPress, row.key)}
            onLongPress={row.onLongPress && releasing(row.onLongPress, row.key)}
            onFocus={index === 0 ? pinToTop : index === destinations.length - 1 ? pinToBottom : undefined}
            isLoading={row.isLoading}
            isNew={row.isNew}
            connected={row.connected}
            disabled={busy}
          />
        ))}
      </ScrollView>
    </View>
  );
}
