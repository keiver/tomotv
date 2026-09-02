import { AboutSection } from "@/components/settings/AboutSection";
import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import React from "react";

interface ServerConnectScreenProps {
  /** Phone tab title (e.g. "Libraries", "Search") so the tab keeps its header while logged out. */
  title?: string;
}

/**
 * Full-screen host for the server list — the exact JELLYFIN SERVER view the Settings tab
 * shows when no server is connected. The Library and Search tabs render this in place of their
 * old error CTA while logged out; no onConnected needed, since their auth gates flip on login
 * and AuthContext routes to the Library root.
 *
 * The header is fixed: the login steps that retitle it are their own routes (app/connect),
 * each carrying its own.
 */
export function ServerConnectScreen({ title }: ServerConnectScreenProps) {
  return (
    // Hangs from the top on every platform, where the connected Settings tab puts its cards;
    // only the pushed login steps centre.
    <ConnectStepScreen title={title} header="JELLYFIN SERVER">
      {/* The same two sections the logged-out Settings tab shows, so no tab drifts. */}
      <ServerConnectFlow />
      <AboutSection showDiagnostics={false} />
    </ConnectStepScreen>
  );
}
