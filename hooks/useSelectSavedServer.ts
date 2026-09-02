import { useFinishLogin } from "@/hooks/useFinishLogin";
import { activateAccount, checkQuickConnectEnabled, getAccountsForServer, resolveServerConnection, upsertSavedServer } from "@/services/jellyfinApi";
import { findServerById } from "@/services/networkDiscovery";
import { SavedAccount, SavedServer } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { Alert } from "react-native";

interface UseSelectSavedServerReturn {
  /** Tap handler for a saved server card: account picker, token reconnect, or login flow. */
  selectServer: (server: SavedServer) => void;
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
 * switcher. A server with saved accounts prompts which one to continue as and
 * reconnects with its stored token after validating it against the server; a
 * dead token falls through to the login step prefilled, and a server that
 * doesn't answer deletes nothing. A server with no saved accounts goes straight
 * to the normal login flow.
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

  const selectServer = useCallback(
    (server: SavedServer) => {
      void (async () => {
        const accounts = await getAccountsForServer(server);
        if (accounts.length === 0) {
          await fallbackToLogin(server);
          return;
        }
        Alert.alert(server.name, "Choose an account", [
          ...accounts.map((account) => ({ text: `Continue as ${account.userName}`, onPress: () => void activate(server, account) })),
          { text: "Sign in as another user", onPress: () => void fallbackToLogin(server) },
          { text: "Cancel", style: "cancel" as const },
        ]);
      })();
    },
    [activate, fallbackToLogin],
  );

  return { selectServer, activatingServerId };
}
