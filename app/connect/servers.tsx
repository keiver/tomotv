import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { ListRow } from "@/components/settings/ListRow";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { settingsStyles } from "@/components/settings/styles";
import { getStoredUserName, isAuthenticated, signOut } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, View } from "react-native";
import { t } from "@/services/i18n";

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
    Alert.alert(t("connect.signOut"), t("connect.signOutConfirm"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("connect.signOut"),
        style: "destructive",
        onPress: async () => {
          try {
            await signOut();
            setSignedIn(false);
            // Back to the tab this was pushed from, which signOut's auth-change has already
            // turned into the server list. dismissTo, not back: it names where it lands.
            router.dismissTo("/(tabs)/settings");
          } catch (error) {
            logger.error("Error signing out", error);
            Alert.alert(t("common.error"), t("connect.signOutFailed"));
          }
        },
      },
    ]);
  };

  return (
    <ConnectStepScreen header={t("settings.jellyfinServer")}>
      <ServerConnectFlow />
      {signedIn && (
        <View style={settingsStyles.section}>
          <ListRow
            icon="log-out"
            tone="destructive"
            title={t("connect.signOut")}
            subtitle={userName ?? undefined}
            onPress={confirmSignOut}
            isFirst
            isLast
            accessibilityHint={t("connect.signOutHint")}
          />
        </View>
      )}
    </ConnectStepScreen>
  );
}
