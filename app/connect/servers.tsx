import { AboutSection } from "@/components/settings/AboutSection";
import { ConnectStepScreen } from "@/components/settings/ConnectStepScreen";
import { ListRow } from "@/components/settings/ListRow";
import { SectionActionBand } from "@/components/settings/SectionActionBand";
import { ServerConnectFlow } from "@/components/settings/ServerConnectFlow";
import { settingsStyles } from "@/components/settings/styles";
import { UiSection } from "@/components/settings/UiSection";
import { getStoredUserName, isAuthenticated, isDemoMode, signOut } from "@/services/jellyfinApi";
import { logger } from "@/utils/logger";
import { router, useFocusEffect } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, Platform, View } from "react-native";
import { t } from "@/services/i18n";

/**
 * The server list as a pushed route, opened by the connected Settings card's Switch
 * Server button and by Add Account on the Who's watching screen. A real stack entry, so
 * Menu (TV) and back (phone) walk back for free; picking a destination switches the
 * session without touching this screen's history (finishLogin pops to the tabs), and
 * the current session survives untouched unless Sign Out below is used. Signed out,
 * the language, appearance and About rows live here too.
 */
export default function ServersScreen() {
  const [signedIn, setSignedIn] = useState(isAuthenticated);
  const [userName, setUserName] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        const [name, demo] = await Promise.all([getStoredUserName(), isDemoMode()]);
        if (cancelled) return;
        setSignedIn(isAuthenticated());
        setUserName(demo ? t("connect.demoPerson") : name);
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
            // The tabs leave the stack on the auth change; the pop to the first route first
            // lands on Who's watching whether that has happened yet or not.
            router.dismissAll();
            router.dismissTo("/who-is-watching");
          } catch (error) {
            logger.error("Error signing out", error);
            Alert.alert(t("common.error"), t("connect.signOutFailed"));
          }
        },
      },
    ]);
  };

  return (
    <ConnectStepScreen header={t("settings.jellyfinServer")} pushed>
      <ServerConnectFlow
        footer={
          signedIn && !Platform.isTV ? (
            <SectionActionBand
              icon="log-out-outline"
              label={userName ? t("connect.signOutUser").replace("{user}", userName) : t("connect.signOut")}
              onPress={confirmSignOut}
              hint={t("connect.signOutHint")}
            />
          ) : undefined
        }
      />
      {signedIn && Platform.isTV && (
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
      {!signedIn && (
        <>
          <UiSection signedIn={false} />
          <AboutSection />
        </>
      )}
    </ConnectStepScreen>
  );
}
