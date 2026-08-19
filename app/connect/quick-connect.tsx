import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { QuickConnectSection } from "@/components/settings/QuickConnectSection";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { useQuickConnect } from "@/hooks/useQuickConnect";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect } from "react";

/**
 * Quick Connect step: shows the code and polls until the server approves it.
 *
 * A pushed route rather than a section swap, so the Apple TV Menu button and the
 * phone's nav bar back button both return to the server list natively. No menu
 * handlers here or anywhere in this flow — see the screen options in app/_layout.tsx.
 * onCancel below only runs on TV, where there is no nav bar to carry it.
 */
export default function QuickConnectScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ url: string; name?: string; serverId?: string }>();
  const quickConnect = useQuickConnect();
  const finishLogin = useFinishLogin();

  // Initiate once for this server. The polling and its teardown belong to the hook.
  useEffect(() => {
    quickConnect.initiate(params.url, params.name ?? "", params.serverId);
    return () => quickConnect.cancel();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.url, params.name, params.serverId]);

  useEffect(() => {
    if (quickConnect.status !== "AUTHENTICATED" || !quickConnect.authResult) return;
    finishLogin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quickConnect.status]);

  return (
    <ConnectStepScreen header={`Authorize on ${params.name || "Jellyfin server"}`.toUpperCase()} centered>
      <QuickConnectSection
        code={quickConnect.code}
        status={quickConnect.status}
        error={quickConnect.error}
        onCancel={() => router.back()}
        onSwitchToPassword={() =>
          router.push({
            pathname: "/connect/login",
            params: { url: params.url, name: params.name, serverId: params.serverId },
          })
        }
      />
    </ConnectStepScreen>
  );
}
