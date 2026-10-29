import { AmbientBackground } from "@/components/ambient-background";
import { BrandCorners } from "@/components/brand-corners";
import { AccountAvatar } from "@/components/settings/AccountAvatar";
import { serverHost } from "@/components/settings/NotConnectedSection";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { useFinishLogin } from "@/hooks/useFinishLogin";
import { useSelectSavedServer } from "@/hooks/useSelectSavedServer";
import { t } from "@/services/i18n";
import { connectToDemoServer, getSavedServersWithAccounts, isAddressTitle } from "@/services/jellyfinApi";
import { SavedAccount, SavedServer } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const pick = (tv: number, pad: number, phone: number) => (IS_TV ? tv : IS_PAD ? pad : phone);
/** The faces here are the screen's whole content, so they are larger than the strip's. */
const FACE_SIZE = pick(168, 104, 88);
/** Phone: the tab title's offset under the status bar, as the connect screens place theirs. */
const TAB_TITLE_TOP = IS_PAD ? 20 : 8;

interface WhoIsWatchingScreenProps {
  /** Phone tab title (e.g. "Home", "Settings") so a tab keeps its header while logged out. */
  title?: string;
  /** Runs after the demo server logs in. */
  onConnected?: () => void | Promise<void>;
}

/** One saved sign-in on the screen. */
export interface Person {
  server: SavedServer;
  account: SavedAccount;
}

/** Everyone who can continue without a login, most recently used first. */
export function sortedPeople(servers: SavedServer[], accountsByServer: Record<string, SavedAccount[]>): Person[] {
  return servers.flatMap((server) => (accountsByServer[server.id] ?? []).map((account) => ({ server, account }))).sort((a, b) => b.account.lastUsedAt - a.account.lastUsedAt);
}

/**
 * Who's watching: the saved accounts as faces, a Demo face while none is saved, and Add Account.
 * The logged-out screen, as the root route and inside a tab that stays for its downloads.
 */
export function WhoIsWatchingScreen({ title, onConnected }: WhoIsWatchingScreenProps) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const finishLogin = useFinishLogin();
  const { continueAs, accountOptions, activatingServerId, activatingUserId } = useSelectSavedServer(onConnected);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [connectingDemo, setConnectingDemo] = useState(false);

  const reload = useCallback(async () => {
    try {
      const { servers, accountsByServer } = await getSavedServersWithAccounts();
      setPeople(sortedPeople(servers, accountsByServer));
    } catch (error) {
      logger.error("Error reading the saved accounts", error);
      setPeople([]);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const connectDemo = async () => {
    setConnectingDemo(true);
    try {
      await connectToDemoServer();
      await finishLogin();
      await onConnected?.();
    } catch (error) {
      Alert.alert(t("connect.demoConnectionFailed"), error instanceof Error ? error.message : t("settings.unableConnectDemo"));
    } finally {
      setConnectingDemo(false);
    }
  };

  const showTitle = !IS_TV && !!title;

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <BrandCorners />
      <View style={[styles.body, sideInsets(insets, pick(0, 24, 16)), !IS_TV && { paddingTop: insets.top + TAB_TITLE_TOP }]}>
        {showTitle && <Text style={settingsStyles.screenTitle}>{title}</Text>}
        <View style={styles.center}>
          <Text style={styles.heading}>{t("connect.whoIsWatching")}</Text>
          <View style={styles.row}>
            {(people ?? []).map(({ server, account }) => (
              <AccountAvatar
                key={`${server.id}:${account.userId}`}
                size={FACE_SIZE}
                label={account.userName}
                sublabel={isAddressTitle(server.name) ? serverHost(server.name) : server.name}
                loading={activatingServerId === server.id && activatingUserId === account.userId}
                disabled={connectingDemo}
                onPress={() => continueAs(server, account)}
                onLongPress={() => accountOptions(server, account, reload)}
              />
            ))}
            {people !== null && people.length === 0 ? (
              <AccountAvatar size={FACE_SIZE} label={t("connect.demoPerson")} sublabel="Tomo TV" loading={connectingDemo} onPress={() => void connectDemo()} />
            ) : null}
            <AccountAvatar size={FACE_SIZE} icon="add" label={t("connect.addAccount")} disabled={connectingDemo} onPress={() => router.push("/connect/servers")} />
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  // Sits a little above the middle, where a title and a row of faces read as centred.
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: pick(96, 48, 32),
  },
  heading: {
    fontSize: pick(40, 30, 26),
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
    textAlign: "center",
    marginBottom: pick(56, 36, 28),
  },
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: pick(36, 20, 12),
  },
});
