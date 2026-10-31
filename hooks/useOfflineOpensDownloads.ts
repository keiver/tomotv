import { downloadManager } from "@/services/downloads/manager";
import { downloadsSupported } from "@/services/downloads/paths";
import { t } from "@/services/i18n";
import { subscribeNetworkPath } from "@/services/localNetworkIdentity";
import { showToast } from "@/services/toast";
import { useNavigation, useRouter } from "expo-router";
import { useEffect, useRef } from "react";

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
  // Survives an effect re-subscribe: the native monitor re-emits the current path on every new listener,
  // so a reset-to-false here would toast a second time while already offline.
  const wasOffline = useRef(false);

  useEffect(() => {
    if (!downloadsSupported()) return;
    let stale = false;
    const unsubscribe = subscribeNetworkPath((available) => {
      // Captured before the await: events arrive in order, so the transition is read and recorded here, not
      // across the hydrate, where two in-flight events could resolve out of order and set the flag backwards.
      const previously = wasOffline.current;
      wasOffline.current = !available;
      void (async () => {
        await downloadManager.hydrate();
        if (stale) return;
        const root = rootNavigation.getState();
        const response = offlineResponse({
          wasOffline: previously,
          available,
          hasReady: downloadManager.getState().entries.some((entry) => entry.state === "ready"),
          onTabs: root?.routes[root.index]?.name === "(tabs)",
        });
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
