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
    // Centred on TV, where this covers the whole screen and a top-aligned list leaves a band
    // of dead screen under it. Phones keep the title and hang the list from the top.
    <ConnectStepScreen title={title} header="JELLYFIN SERVER" centered>
      {/* Server list only. The Open Source link is gone from this state on every tab that
          renders it (Home, Search, Settings): logged out, the only thing on screen should be
          the one thing there is to do, and a second link under the server list read as another
          step. It returns on the connected Settings tab. */}
      <ServerConnectFlow />
    </ConnectStepScreen>
  );
}
