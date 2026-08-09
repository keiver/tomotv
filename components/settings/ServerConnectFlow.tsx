import { NotConnectedSection } from "@/components/settings/NotConnectedSection";
import { QuickConnectSection } from "@/components/settings/QuickConnectSection";
import { UsernamePasswordSection } from "@/components/settings/UsernamePasswordSection";
import { useLibrary } from "@/contexts/LibraryContext";
import { clearFolderContentsCache } from "@/services/folderContentsCache";
import {
  authenticateByName,
  checkQuickConnectEnabled,
  connectToDemoServer,
  getSavedServers,
  removeSavedServer,
  renameSavedServer,
  resolveServerConnection,
  saveAuthResult,
} from "@/services/jellyfinApi";
import { subnetMismatchHint } from "@/services/networkDiscovery";
import { useNetworkScan } from "@/hooks/useNetworkScan";
import { useQuickConnect } from "@/hooks/useQuickConnect";
import { SavedServer } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, Keyboard, TextInput } from "react-native";

export type FlowStep = "SERVER_LIST" | "QUICK_CONNECT" | "USERNAME_PASSWORD";

interface ServerConnectFlowProps {
  /**
   * Runs after a successful login (any path), once the library has refreshed and the folder
   * cache is cleared. Hosts whose visibility is gated on auth (Library, Search) can omit it —
   * their gates flip on the auth change and AuthContext routes to the Library root.
   */
  onConnected?: () => void | Promise<void>;
  /** Fires on every step change so the host can retitle its section header (the flow renders
   * sections only; the header belongs to the host). */
  onFlowStepChange?: (step: FlowStep) => void;
}

/**
 * The whole server connect state machine — the server list (add / scan / discovered / saved /
 * demo rows) plus the inline Quick Connect and username+password login steps. Rendered by the
 * Settings tab under its JELLYFIN SERVER header, and full-screen by the Library and Search tabs
 * (via ServerConnectScreen) when no server is connected. Sections only; the host owns the
 * scroll container and header.
 */
export function ServerConnectFlow({ onConnected, onFlowStepChange }: ServerConnectFlowProps) {
  const { refreshLibrary } = useLibrary();

  const [flowStep, setFlowStep] = useState<FlowStep>("SERVER_LIST");

  useEffect(() => {
    onFlowStepChange?.(flowStep);
    // Notify on step changes only — a re-render with a new callback identity is not a step change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowStep]);
  const [serverUrl, setServerUrl] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [serverName, setServerName] = useState("");
  const [serverSystemId, setServerSystemId] = useState<string | undefined>(undefined);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [isConnectingDemo, setIsConnectingDemo] = useState(false);
  const [savedServers, setSavedServers] = useState<SavedServer[]>([]);
  const [connectingServerId, setConnectingServerId] = useState<string | null>(null);

  const quickConnect = useQuickConnect();
  const scan = useNetworkScan();
  const serverUrlRef = useRef<TextInput>(null);
  const usernameRef = useRef<TextInput>(null);
  const passwordRef = useRef<TextInput>(null);

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

  // Every login path funnels through here. Await each step in sequence: refreshing the library
  // and clearing the folder cache before the host's onConnected (which may navigate) keeps the
  // Library root from racing the auth-change remounts with stale content.
  const finishLogin = async () => {
    await refreshLibrary();
    clearFolderContentsCache();
    await onConnected?.();
  };

  React.useEffect(() => {
    if (quickConnect.status !== "AUTHENTICATED" || !quickConnect.authResult) return;
    finishLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickConnect.status]);

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
      setServerName(info.ServerName);
      setServerSystemId(info.Id);

      const quickConnectEnabled = await checkQuickConnectEnabled(resolvedUrl);
      if (quickConnectEnabled) {
        quickConnect.initiate(resolvedUrl, info.ServerName, info.Id);
        setFlowStep("QUICK_CONNECT");
      } else {
        setFlowStep("USERNAME_PASSWORD");
      }
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

  const handleSignIn = async () => {
    const trimmedUser = username.trim();
    if (!trimmedUser) {
      Alert.alert("Missing Username", "Please enter your username.");
      return;
    }

    setIsSigningIn(true);
    try {
      const cleanUrl = serverUrl.trim().replace(/\/+$/, "");
      const auth = await authenticateByName(cleanUrl, trimmedUser, password);
      await saveAuthResult(cleanUrl, auth.AccessToken, auth.User.Id, auth.User.Name, serverName, "password", serverSystemId);
      await finishLogin();
    } catch (error) {
      Alert.alert("Sign In Failed", error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleConnectDemo = async () => {
    setIsConnectingDemo(true);
    try {
      await connectToDemoServer();
      await finishLogin();
    } catch (error) {
      Alert.alert("Demo Connection Failed", error instanceof Error ? error.message : "Unable to connect to demo server.");
    } finally {
      setIsConnectingDemo(false);
    }
  };

  const switchToUsernamePassword = () => {
    quickConnect.cancel();
    setFlowStep("USERNAME_PASSWORD");
  };

  const switchToQuickConnect = () => {
    setUsername("");
    setPassword("");
    quickConnect.initiate(serverUrl.trim(), serverName);
    setFlowStep("QUICK_CONNECT");
  };

  const goBackToServerUrl = () => {
    quickConnect.cancel();
    setUsername("");
    setPassword("");
    setFlowStep("SERVER_LIST");
  };

  return (
    <>
      {flowStep === "SERVER_LIST" && (
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
      )}

      {flowStep === "QUICK_CONNECT" && (
        <QuickConnectSection code={quickConnect.code} status={quickConnect.status} error={quickConnect.error} onCancel={goBackToServerUrl} onSwitchToPassword={switchToUsernamePassword} />
      )}

      {flowStep === "USERNAME_PASSWORD" && (
        <UsernamePasswordSection
          username={username}
          setUsername={setUsername}
          password={password}
          setPassword={setPassword}
          usernameRef={usernameRef}
          passwordRef={passwordRef}
          isSigningIn={isSigningIn}
          onSignIn={handleSignIn}
          onBack={goBackToServerUrl}
          onSwitchToQuickConnect={switchToQuickConnect}
          serverName={serverName}
        />
      )}
    </>
  );
}
