import { ConnectedDestination, NotConnectedSection } from "@/components/settings/NotConnectedSection";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { useSelectSavedServer } from "@/hooks/useSelectSavedServer";
import {
  checkQuickConnectEnabled,
  connectToDemoServer,
  getAccountsForServer,
  getConfig,
  getSavedServers,
  getStoredServerId,
  isAuthenticated,
  isDemoMode,
  removeAccount,
  removeSavedServerAndAccounts,
  renameSavedServer,
  resolveServerConnection,
} from "@/services/jellyfinApi";
import { subnetMismatchHint } from "@/services/networkDiscovery";
import { useNetworkScan } from "@/hooks/useNetworkScan";
import { SavedServer } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Alert, Keyboard, TextInput } from "react-native";

interface ServerConnectFlowProps {
  /**
   * Runs after the demo server logs in. The login steps live on their own routes and
   * finish through useFinishLogin, so hosts gated on auth (Library, Search) can omit
   * this — their gates flip on the auth change and AuthContext routes to the Library root.
   */
  onConnected?: () => void | Promise<void>;
}

/**
 * The server list: add, scan, discovered, saved and demo destinations. Rendered by the
 * Settings tab under its JELLYFIN SERVER header, and full-screen by the Library and Search
 * tabs (via ServerConnectScreen) when no server is connected. Sections only; the host owns
 * the scroll container and header.
 *
 * Picking a server resolves the address here, then PUSHES the matching login step
 * (app/connect). Those steps used to be sections swapped in by a flowStep state machine,
 * which left Menu nothing to pop: it moved focus to the tab bar, then quit the app.
 */
export function ServerConnectFlow({ onConnected }: ServerConnectFlowProps) {
  const router = useRouter();
  const finishLogin = useFinishLogin();

  const [serverUrl, setServerUrl] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [isConnectingDemo, setIsConnectingDemo] = useState(false);
  const [savedServers, setSavedServers] = useState<SavedServer[]>([]);
  const [savedAccountNames, setSavedAccountNames] = useState<Record<string, string[]>>({});
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null);
  const [connected, setConnected] = useState<ConnectedDestination | null>(null);

  const scan = useNetworkScan();
  const serverUrlRef = useRef<TextInput>(null);
  const { selectServer, activatingServerId } = useSelectSavedServer(onConnected);

  const reloadSavedServers = async () => {
    try {
      const servers = await getSavedServers();
      setSavedServers(servers);
      // Pills per card: who can continue without a login, up to three names and a +N for the rest.
      const names: Record<string, string[]> = {};
      for (const server of servers) {
        const accounts = await getAccountsForServer(server);
        if (accounts.length === 0) continue;
        const shown = accounts.slice(0, 3).map((account) => account.userName);
        names[server.id] = accounts.length > 3 ? [...shown, `+${accounts.length - 3}`] : shown;
      }
      setSavedAccountNames(names);
    } catch (error) {
      logger.error("Error reloading saved servers", error);
    }
  };

  // Which row is the live session, for its checkmark. Read on focus like the cards:
  // picking a destination replaces the session and pops back here.
  const reloadConnected = async () => {
    if (!isAuthenticated()) {
      setConnected(null);
      return;
    }
    try {
      const [serverId, config, demo] = await Promise.all([getStoredServerId(), getConfig(), isDemoMode()]);
      setConnected({ serverId, url: config.server, demo });
    } catch (error) {
      logger.error("Error reading the connected server", error);
      setConnected(null);
    }
  };

  useFocusEffect(
    useCallback(() => {
      reloadSavedServers();
      reloadConnected();
      return () => {
        Keyboard.dismiss();
      };
    }, []),
  );

  const handleConnectServer = async (address?: string) => {
    const trimmed = (address ?? serverUrl).trim();
    if (!trimmed) {
      Alert.alert("Missing Address", "Please enter your Jellyfin server IP, hostname, or URL.");
      return;
    }
    if (address !== undefined) setServerUrl(address);

    setIsValidating(true);
    try {
      // Accepts a bare IP/hostname (auto-discovers protocol + port) or a full URL.
      const { url: resolvedUrl, info } = await resolveServerConnection(trimmed);
      setServerUrl(resolvedUrl);

      // Servers with Quick Connect switched off go straight to the password step; both
      // are routes under the same stack, so Menu walks back either way.
      const quickConnectEnabled = await checkQuickConnectEnabled(resolvedUrl);
      router.push({
        pathname: quickConnectEnabled ? "/connect/quick-connect" : "/connect/login",
        params: { url: resolvedUrl, name: info.ServerName, serverId: info.Id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to connect to server.";
      // A private address on another subnet is a common dead end that the probe
      // errors alone can't explain, so name it when we can see it.
      const hint = subnetMismatchHint(trimmed, scan.local);
      Alert.alert("Connection Failed", hint ? `${message}\n\n${hint}` : message);
    } finally {
      setIsValidating(false);
      setConnectingServerId(null);
    }
  };

  // Tapping a saved card offers its saved accounts (token reconnect) or the login flow.
  const handleSelectServer = selectServer;

  const handleSelectDiscovered = (url: string) => {
    // Discovered rows are keyed by url, so that's what drives their spinner.
    setConnectingServerId(url);
    handleConnectServer(url);
  };

  const promptRenameServer = (server: SavedServer) => {
    Alert.prompt(
      "Rename Server",
      "Enter a name for this server.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Save",
          onPress: async (text?: string) => {
            await renameSavedServer(server.id, text ?? "");
            await reloadSavedServers();
          },
        },
      ],
      "plain-text",
      server.name,
    );
  };

  const confirmRemoveServer = (server: SavedServer) => {
    Alert.alert("Remove Server", "Remove this saved server and its saved sign-ins?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await removeSavedServerAndAccounts(server);
          await reloadSavedServers();
        },
      },
    ]);
  };

  // Long-press a saved card → rename or remove it, or forget one saved sign-in.
  const handleServerOptions = async (server: SavedServer) => {
    const accounts = await getAccountsForServer(server);
    Alert.alert(server.name, undefined, [
      { text: "Edit Name", onPress: () => promptRenameServer(server) },
      ...accounts.map((account) => ({
        text: `Forget ${account.userName}`,
        style: "destructive" as const,
        onPress: async () => {
          await removeAccount(account.serverId, account.userId);
          await reloadSavedServers();
        },
      })),
      { text: "Remove", style: "destructive", onPress: () => confirmRemoveServer(server) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  // The demo server carries its own credentials, so it logs in from here with no step in between.
  const handleConnectDemo = async () => {
    setIsConnectingDemo(true);
    try {
      await connectToDemoServer();
      await finishLogin();
      await onConnected?.();
    } catch (error) {
      Alert.alert("Demo Connection Failed", error instanceof Error ? error.message : "Unable to connect to demo server.");
    } finally {
      setIsConnectingDemo(false);
    }
  };

  return (
    <NotConnectedSection
      serverUrl={serverUrl}
      setServerUrl={setServerUrl}
      serverUrlRef={serverUrlRef}
      isValidating={isValidating}
      isConnectingDemo={isConnectingDemo}
      onConnect={handleConnectServer}
      onConnectDemo={handleConnectDemo}
      savedServers={savedServers}
      connected={connected}
      savedServerAccounts={savedAccountNames}
      connectingServerId={connectingServerId ?? activatingServerId}
      onSelectServer={handleSelectServer}
      onServerOptions={handleServerOptions}
      scan={scan}
      onSelectDiscovered={handleSelectDiscovered}
    />
  );
}
