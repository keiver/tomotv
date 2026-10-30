import { downloadManager } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { t } from "@/services/i18n";
import { subscribeNetworkPath } from "@/services/localNetworkIdentity";
import { showToast } from "@/services/toast";
import { useNavigation, useRouter } from "expo-router";
import { useEffect } from "react";

export interface OfflineCheck {
  wasOffline: boolean;
  available: boolean;
  hasReady: boolean;
  /** Nothing is pushed over the tabs: a player or item screen is never closed or covered by this. */
  onTabs: boolean;
}

/** Once per drop of the connection, on the tabs: say so, and switch to Downloads when one can play. */
export function offlineResponse({ wasOffline, available, hasReady, onTabs }: OfflineCheck): { notify: boolean; openDownloads: boolean } {
  const notify = !available && !wasOffline && onTabs;
  return { notify, openDownloads: notify && hasReady };
}

/** The connection dropping, at launch or while the app runs, tells the viewer and opens Downloads. */
export function useOfflineOpensDownloads(): void {
  const router = useRouter();
  const rootNavigation = useNavigation();

  useEffect(() => {
    if (!downloadsSupported()) return;
    let wasOffline = false;
    let stale = false;
    const unsubscribe = subscribeNetworkPath((available) => {
      void (async () => {
        await downloadManager.hydrate();
        if (stale) return;
        const root = rootNavigation.getState();
        const response = offlineResponse({
          wasOffline,
          available,
          hasReady: downloadManager.getState().entries.some((entry) => entry.state === "ready"),
          onTabs: root?.routes[root.index]?.name === "(tabs)",
        });
        wasOffline = !available;
        if (response.notify) showToast(t("downloads.offline"));
        if (response.openDownloads) router.navigate("/downloads");
      })();
    });
    return () => {
      stale = true;
      unsubscribe();
    };
  }, [router, rootNavigation]);
}
