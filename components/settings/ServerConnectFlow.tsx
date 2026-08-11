import { NotConnectedSection } from "@/components/settings/NotConnectedSection";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { checkQuickConnectEnabled, connectToDemoServer, getSavedServers, removeSavedServer, renameSavedServer, resolveServerConnection } from "@/services/jellyfinApi";
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
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null);

  const scan = useNetworkScan();
  const serverUrlRef = useRef<TextInput>(null);

  const reloadSavedServers = async () => {
    try {
      setSavedServers(await getSavedServers());
    } catch (error) {
      logger.error("Error reloading saved servers", error);
    }
  };

  useFocusEffect(
    useCallback(() => {
      reloadSavedServers();
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

  const handleSelectServer = (server: SavedServer) => {
    // Tapping a saved card prefills the address and runs the normal login flow.
    setConnectingServerId(server.id);
    handleConnectServer(server.url);
  };

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
    Alert.alert("Remove Server", "Remove this saved server?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await removeSavedServer(server.id);
          await reloadSavedServers();
        },
      },
    ]);
  };

  // Long-press a saved card → edit (rename) or remove it.
  const handleServerOptions = (server: SavedServer) => {
    Alert.alert(server.name, undefined, [
      { text: "Edit Name", onPress: () => promptRenameServer(server) },
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
      connectingServerId={connectingServerId}
      onSelectServer={handleSelectServer}
      onServerOptions={handleServerOptions}
      scan={scan}
      onSelectDiscovered={handleSelectDiscovered}
    />
  );
}
