import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { ListRow } from "@/components/settings/ListRow";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { settingsStyles } from "@/components/settings/styles";
import { getStoredUserName, isAuthenticated, signOut } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, View } from "react-native";

/**
 * The server list as a pushed route, opened by the connected Settings card's
 * Switch Server button. A real stack entry, so Menu (TV) and back (phone) walk
 * home for free; picking a destination switches the session without touching
 * this screen's history (finishLogin pops to the tabs), and the current
 * session survives untouched unless Sign Out below is used.
 */
export default function ServersScreen() {
  const [signedIn, setSignedIn] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const name = await getStoredUserName();
        if (cancelled) return;
        setSignedIn(isAuthenticated());
        setUserName(name);
      })();
      return () => {
        cancelled = true;
      };
    }, []),
  );

  const confirmSignOut = () => {
    Alert.alert("Sign Out", "Are you sure you want to sign out?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign Out",
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
            // Stay here: the list above is exactly where to pick what's next.
            setSignedIn(false);
          } catch (error) {
            logger.error("Error signing out", error);
            Alert.alert("Error", "Failed to sign out.");
          }
        },
      },
    ]);
  };

  return (
    <ConnectStepScreen header="JELLYFIN SERVER">
      <ServerConnectFlow />
      {signedIn && (
        <View style={settingsStyles.section}>
          <ListRow icon="log-out-outline" title="Sign Out" subtitle={userName ?? undefined} onPress={confirmSignOut} isFirst isLast accessibilityHint="Ends the current session; saved sign-ins stay" />
        </View>
      )}
    </ConnectStepScreen>
  );
}
