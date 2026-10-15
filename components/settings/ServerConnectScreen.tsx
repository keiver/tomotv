import { AboutSection } from "@/components/settings/AboutSection";
import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { UiSection } from "@/components/settings/UiSection";
import { t } from "@/services/i18n";
import React from "react";

interface ServerConnectScreenProps {
  /** Phone tab title (e.g. "Home", "Settings") so the tab keeps its header while logged out. */
  title?: string;
  /** Runs after the demo server logs in; see ServerConnectFlow. */
  onConnected?: () => void | Promise<void>;
}

/** The logged-out screen every tab renders, Settings included. */
export function ServerConnectScreen({ title, onConnected }: ServerConnectScreenProps) {
  return (
    // Hangs from the top on every platform; only the pushed login steps centre.
    <ConnectStepScreen title={title} header={t("settings.jellyfinServer")}>
      <ServerConnectFlow onConnected={onConnected} />
      <UiSection signedIn={false} />
      <AboutSection showDiagnostics={false} />
    </ConnectStepScreen>
  );
}
