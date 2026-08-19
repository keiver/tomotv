import { useFinishLogin } from "@/hooks/useFinishLogin";
import { activateAccount, checkQuickConnectEnabled, getAccountsForServer, resolveServerConnection } from "@/services/jellyfinApi";
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
        const { url: resolvedUrl, info } = await resolveServerConnection(server.url);
        const useQuickConnect = account ? account.authMethod === "quickconnect" : await checkQuickConnectEnabled(resolvedUrl);
        router.push({
          pathname: useQuickConnect ? "/connect/quick-connect" : "/connect/login",
          params: { url: resolvedUrl, name: info.ServerName, serverId: info.Id, username: account?.userName },
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
        const result = await activateAccount(account);
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
