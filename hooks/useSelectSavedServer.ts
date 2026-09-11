import { useFinishLogin } from "@/hooks/useFinishLogin";
import { activateAccount, checkQuickConnectEnabled, resolveServerConnection, upsertSavedServer } from "@/services/jellyfinApi";
import { findServerById } from "@/services/networkDiscovery";
import { SavedAccount, SavedServer } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert } from "react-native";

interface UseSelectSavedServerReturn {
  /** One saved account, picked off the people strip: reconnects with its token. */
  continueAs: (server: SavedServer, account: SavedAccount) => void;
  /** A server row press: the login step on that server. */
  signIn: (server: SavedServer) => void;
  /** Id of the server currently connecting, to drive its card's spinner. */
  activatingServerId: string | null;
}

/**
 * A saved server that stopped answering at its address may have moved on this
 * LAN (a new DHCP lease is the usual cause). Sweep for its system Id and, when
 * found, point the card at the new address before anything connects to it.
 */
async function locateMovedServer(server: SavedServer): Promise<SavedServer | null> {
  if (!server.serverId) return null;
  const moved = await findServerById(server.serverId);
  if (!moved) return null;
  logger.info("Saved server found at a new address", { service: "JellyfinAPI", serverName: server.name, url: moved.url });
  await upsertSavedServer(moved.url, moved.name, server.serverId);
  return { ...server, url: moved.url };
}

/**
 * Picking a saved server, shared by the logged-out list and the connected
 * switcher. A saved account reconnects with its stored token after validating
 * it against the server; a dead token falls through to the login step
 * prefilled, and a server that doesn't answer deletes nothing.
 */
export function useSelectSavedServer(onConnected?: () => void | Promise<void>): UseSelectSavedServerReturn {
  const router = useRouter();
  const finishLogin = useFinishLogin();
  const [activatingServerId, setActivatingServerId] = useState<string | null>(null);

  /**
   * Resolve the address and push the matching login step. With a known account
   * the route follows how that account signed in last time (its Quick Connect
   * approval or its password, prefilled by name); without one, Quick Connect
   * leads when the server offers it — same order as the add-server flow.
   */
  const fallbackToLogin = useCallback(
    async (server: SavedServer, account?: SavedAccount) => {
      setActivatingServerId(server.id);
      try {
        let resolved: { url: string; name: string; serverId: string };
        try {
          const { url, info } = await resolveServerConnection(server.url);
          resolved = { url, name: info.ServerName, serverId: info.Id };
        } catch (error) {
          const moved = await locateMovedServer(server);
          if (!moved) throw error;
          const { url, info } = await resolveServerConnection(moved.url);
          resolved = { url, name: info.ServerName, serverId: info.Id };
        }
        const useQuickConnect = account ? account.authMethod === "quickconnect" : await checkQuickConnectEnabled(resolved.url);
        router.push({
          pathname: useQuickConnect ? "/connect/quick-connect" : "/connect/login",
          params: { url: resolved.url, name: resolved.name, serverId: resolved.serverId, username: account?.userName },
        });
      } catch (error) {
        Alert.alert("Connection Failed", error instanceof Error ? error.message : "Unable to connect to server.");
      } finally {
        setActivatingServerId(null);
      }
    },
    [router],
  );

  const activate = useCallback(
    async (server: SavedServer, account: SavedAccount) => {
      setActivatingServerId(server.id);
      try {
        let result = await activateAccount(account);
        if (result === "unreachable") {
          const moved = await locateMovedServer(server);
          if (moved) {
            server = moved;
            account = { ...account, serverUrl: moved.url };
            result = await activateAccount(account);
          }
        }
        if (result === "connected") {
          await finishLogin();
          await onConnected?.();
          return;
        }
        if (result === "needs_login") {
          // The alert names why the password step appears; the step itself is prefilled.
          Alert.alert("Session Expired", `${server.name} no longer accepts the saved session for ${account.userName}. Sign in again to continue.`, [
            { text: "OK", onPress: () => void fallbackToLogin(server, account) },
          ]);
          return;
        }
        Alert.alert("Server Unreachable", `Couldn't reach ${server.name}. Check that it is running and on this network.`);
      } catch (error) {
        logger.error("Account switch failed", error, { service: "JellyfinAPI" });
        Alert.alert("Connection Failed", error instanceof Error ? error.message : "Unable to connect to server.");
      } finally {
        setActivatingServerId(null);
      }
    },
    [finishLogin, onConnected, fallbackToLogin],
  );

  const continueAs = useCallback((server: SavedServer, account: SavedAccount) => void activate(server, account), [activate]);
  const signIn = useCallback((server: SavedServer) => void fallbackToLogin(server), [fallbackToLogin]);

  return { continueAs, signIn, activatingServerId };
}
