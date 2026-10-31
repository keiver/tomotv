import { ListRow } from "@/components/settings/ListRow";
import { SwipeToRemove } from "@/components/settings/SwipeToRemove";
import { settingsStyles } from "@/components/settings/styles";
import { useLastSession } from "@/hooks/useLastSession";
import { useSentSessions } from "@/hooks/useSentSessions";
import { removeSend } from "@/services/diagnosticsInbox";
import { logText, savedAt } from "@/services/diagnosticsLog";
import type { SentSession } from "@/services/diagnosticsOutbox";
import { mailLog } from "@/services/diagnosticsShare";
import { clearLastSession, type PlaybackSession } from "@/services/playbackProbe";
import { describePlayback } from "@/services/playbackStory";
import { THIS_DEVICE, type DeviceName } from "@/utils/hostEnvironment";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { logger } from "@/utils/logger";
import { Alert, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { t } from "@/services/i18n";

/**
 * DiagnosticsSection: the saved playback sessions, one row per device. `app/diagnostics.tsx`
 * carries the version and the last playback's engine log, which a bug report needs. Logged out
 * there is no playback to read, and with no session the whole section stays off the screen.
 */
const stamp = (t: number) => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
/** A session this young wears the green dot: it is the one the viewer just made or was just sent. */
const FRESH_MS = 5 * 60 * 1000;
const fresh = (at: number, now: number) => now - at < FRESH_MS;
/** This device is named as such; two Apple TVs read alike, so a sender is its family and the head of its id. */
const ownTitle = () => t("settings.thisDevice").replace("{device}", THIS_DEVICE);
const senderTitle = (device: DeviceName, deviceId: string) => `${device} ${deviceId.split("-")[0].toUpperCase()}`;
const rowActions = () =>
  [
    { name: "email", label: t("common.email") },
    { name: "remove", label: t("common.remove") },
  ] as const;

export function DiagnosticsSection() {
  const router = useRouter();
  const own = useLastSession();
  const openDiagnostics = useCallback(() => router.push("/diagnostics"), [router]);
  // Slots belong to the account that was read; a screen with no connection lists none.
  const sends = useSentSessions();
  // The clock the fresh dots read, taken on each look at the screen rather than on each render.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => setNow(Date.now()), []));
  const openSent = useCallback((sender: string) => router.push({ pathname: "/diagnostics", params: { sender } }), [router]);
  const emailOwn = useCallback((session: PlaybackSession) => {
    const text = logText(session, describePlayback(session, true));
    void mailLog(text, `Tomo TV diagnostics, ${THIS_DEVICE}`).catch((error) => logger.warn("Mail unavailable", error, { service: "DiagnosticsSection" }));
  }, []);
  const confirmRemoveOwn = useCallback(() => {
    Alert.alert(t("settings.removeThisDevice").replace("{device}", THIS_DEVICE), t("settings.removeThisDeviceBody").replace("{device}", THIS_DEVICE), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.remove"), style: "destructive", onPress: clearLastSession },
    ]);
  }, []);
  const emailSent = useCallback((sent: SentSession) => {
    const text = logText(sent.session, describePlayback(sent.session, false));
    void mailLog(text, `Tomo TV diagnostics, ${sent.session.device.family}`).catch((error) => logger.warn("Mail unavailable", error, { service: "DiagnosticsSection" }));
  }, []);
  const confirmRemove = useCallback((sent: SentSession) => {
    Alert.alert(t("settings.removeDiagnostics").replace("{family}", sent.session.device.family), t("settings.removeDiagnosticsBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () =>
          void removeSend(sent.sender).catch((error) => {
            logger.warn("Diagnostics remove failed", error, { service: "DiagnosticsSection" });
            Alert.alert(t("settings.couldNotRemove"), t("settings.serverRefused"));
          }),
      },
    ]);
  }, []);

  if (!own && sends.length === 0) return null;

  return (
    <>
      <View style={settingsStyles.sectionHeader}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.diagnosticsHeader")}</Text>
      </View>
      <View style={settingsStyles.section}>
        {/* The swipe on a diagnostics row needs a gesture root, and the Settings tab has none. Styled,
            because the root's default is flex: 1 and this sits in a content-sized card. */}
        <GestureHandlerRootView style={styles.gestureRoot}>
          {own && (
            <SwipeToRemove label={t("settings.thisDeviceDiag").replace("{device}", THIS_DEVICE)} onRemove={confirmRemoveOwn} onEmail={() => emailOwn(own)}>
              <ListRow
                icon="pulse"
                title={ownTitle()}
                subtitleDot={fresh(savedAt(own), now)}
                subtitle={t("settings.savedStamp").replace("{when}", stamp(savedAt(own)))}
                trailingIcon="chevron-forward"
                onPress={openDiagnostics}
                onLongPress={confirmRemoveOwn}
                accessibilityActions={rowActions()}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "remove") confirmRemoveOwn();
                  if (event.nativeEvent.actionName === "email") emailOwn(own);
                }}
                isFirst
                isLast={sends.length === 0}
                accessibilityLabel={t("settings.diagThisDevice")
                  .replace("{device}", THIS_DEVICE)
                  .replace("{when}", stamp(savedAt(own)))}
                accessibilityHint={t("settings.swipeToRemove")}
              />
            </SwipeToRemove>
          )}
          {sends.map((sent, index) => (
            <SwipeToRemove key={sent.sender} label={t("settings.diagFamily").replace("{family}", sent.session.device.family)} onRemove={() => confirmRemove(sent)} onEmail={() => emailSent(sent)}>
              <ListRow
                icon="pulse"
                title={senderTitle(sent.session.device.family, sent.sender)}
                subtitleDot={fresh(sent.sentAt, now)}
                subtitle={t("settings.diagReceived").replace("{when}", stamp(sent.sentAt))}
                trailingIcon="chevron-forward"
                onPress={() => openSent(sent.sender)}
                onLongPress={() => confirmRemove(sent)}
                accessibilityActions={rowActions()}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "remove") confirmRemove(sent);
                  if (event.nativeEvent.actionName === "email") emailSent(sent);
                }}
                isFirst={!own && index === 0}
                isLast={index === sends.length - 1}
                accessibilityLabel={t("settings.diagFromFamily").replace("{family}", sent.session.device.family).replace("{when}", stamp(sent.sentAt))}
                accessibilityHint={t("settings.swipeToRemove")}
              />
            </SwipeToRemove>
          ))}
        </GestureHandlerRootView>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  gestureRoot: {
    flexShrink: 1,
  },
});
