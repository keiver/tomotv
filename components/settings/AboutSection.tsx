import { ListRow } from "@/components/settings/ListRow";
import { SwipeToRemove } from "@/components/settings/SwipeToRemove";
import { settingsStyles } from "@/components/settings/styles";
import { ABOUT_LABEL } from "@/constants/app";
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
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { t } from "@/services/i18n";

/**
 * AboutSection — the app's two reference destinations.
 *
 * `app/licenses.tsx` carries the license texts and the LGPL source offer for FFmpeg and
 * GNU FriBidi (constants/licenses.ts); this row is its only entry point. `app/diagnostics.tsx`
 * carries the version and the last playback's engine log, which a bug report needs.
 *
 * Labelled "Open Source" rather than "Acknowledgements" so it matches the title the
 * destination already renders, and because that is the phrase this audience recognises.
 * Not "Disclaimers": the page disclaims nothing, it credits authors and carries the LGPL
 * written offer of source, and naming an obligation after its opposite is the kind of
 * thing that matters if anyone ever checks.
 *
 * The build's version heads the Open Source page and the Diagnostics log, rather than
 * sitting on a row here that nobody came to this screen to read. A session an Apple TV sent
 * to this account is one more row, per sending device.
 */
interface AboutSectionProps {
  /** Logged out there is no playback to read; the row is hidden then, and until something plays. */
  showDiagnostics: boolean;
}

const stamp = (t: number) => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
const PLATFORM_ICON: Record<DeviceName, "phone-portrait-outline" | "tablet-portrait-outline" | "laptop-outline" | "tv-outline"> = {
  iPhone: "phone-portrait-outline",
  iPad: "tablet-portrait-outline",
  Mac: "laptop-outline",
  "Apple TV": "tv-outline",
};
/** A session this young wears the green dot: it is the one the viewer just made or was just sent. */
const FRESH_MS = 5 * 60 * 1000;
const fresh = (at: number, now: number) => now - at < FRESH_MS;
/** This device is named as such; two Apple TVs read alike, so a sender is its glyph and the head of its id. */
const OWN_PILL = { icon: PLATFORM_ICON[THIS_DEVICE], label: t("settings.thisDevice").replace("{device}", THIS_DEVICE) };
const senderPill = (device: DeviceName, deviceId: string) => ({ icon: PLATFORM_ICON[device], label: deviceId.split("-")[0].toUpperCase() });
const ROW_ACTIONS = [
  { name: "email", label: t("common.email") },
  { name: "remove", label: t("common.remove") },
] as const;
const EMPTY_SENDS: SentSession[] = [];

export function AboutSection({ showDiagnostics }: AboutSectionProps) {
  const router = useRouter();
  const lastSession = useLastSession();
  const own = showDiagnostics ? lastSession : null;
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);
  const openDiagnostics = useCallback(() => router.push("/diagnostics"), [router]);
  // Slots belong to the account that was read; a screen with no connection lists none.
  const received = useSentSessions();
  const sends = showDiagnostics ? received : EMPTY_SENDS;
  // The clock the fresh dots read, taken on each look at the screen rather than on each render.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => setNow(Date.now()), []));
  const openSent = useCallback((sender: string) => router.push({ pathname: "/diagnostics", params: { sender } }), [router]);
  const emailOwn = useCallback((session: PlaybackSession) => {
    const text = logText(session, describePlayback(session, true));
    void mailLog(text, `Tomo TV diagnostics, ${THIS_DEVICE}`).catch((error) => logger.warn("Mail unavailable", error, { service: "AboutSection" }));
  }, []);
  const confirmRemoveOwn = useCallback(() => {
    Alert.alert(t("settings.removeThisDevice").replace("{device}", THIS_DEVICE), t("settings.removeThisDeviceBody").replace("{device}", THIS_DEVICE), [
      { text: t("common.cancel"), style: "cancel" },
      { text: t("common.remove"), style: "destructive", onPress: clearLastSession },
    ]);
  }, []);
  const emailSent = useCallback((sent: SentSession) => {
    const text = logText(sent.session, describePlayback(sent.session, false));
    void mailLog(text, `Tomo TV diagnostics, ${sent.session.device.family}`).catch((error) => logger.warn("Mail unavailable", error, { service: "AboutSection" }));
  }, []);
  const confirmRemove = useCallback((sent: SentSession) => {
    Alert.alert(t("settings.removeDiagnostics").replace("{family}", sent.session.device.family), t("settings.removeDiagnosticsBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () =>
          void removeSend(sent.sender).catch((error) => {
            logger.warn("Diagnostics remove failed", error, { service: "AboutSection" });
            Alert.alert(t("settings.couldNotRemove"), t("settings.serverRefused"));
          }),
      },
    ]);
  }, []);

  const ownRow = own && (
    <SwipeToRemove label={t("settings.thisDeviceDiag").replace("{device}", THIS_DEVICE)} onRemove={confirmRemoveOwn} onEmail={() => emailOwn(own)}>
      <ListRow
        icon="pulse"
        title={t("settings.diagnostics")}
        titlePill={OWN_PILL}
        subtitleDot={fresh(savedAt(own), now)}
        subtitle={t("settings.savedStamp").replace("{when}", stamp(savedAt(own)))}
        trailingIcon="chevron-forward"
        onPress={openDiagnostics}
        onLongPress={confirmRemoveOwn}
        accessibilityActions={ROW_ACTIONS}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "remove") confirmRemoveOwn();
          if (event.nativeEvent.actionName === "email") emailOwn(own);
        }}
        isLast={sends.length === 0}
        accessibilityLabel={t("settings.diagThisDevice")
          .replace("{device}", THIS_DEVICE)
          .replace("{when}", stamp(savedAt(own)))}
        accessibilityHint={t("settings.swipeToRemove")}
      />
    </SwipeToRemove>
  );

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.about")}</Text>
      </View>
      <View style={settingsStyles.section}>
        {/* The swipe on a diagnostics row needs a gesture root, and the Settings tab has none. Styled,
            because the root's default is flex: 1 and this sits in a content-sized card. */}
        <GestureHandlerRootView style={styles.gestureRoot}>
          <ListRow
            icon="document-text"
            title={ABOUT_LABEL}
            subtitle={t("settings.licenses")}
            trailingIcon="chevron-forward"
            onPress={openLicenses}
            isFirst
            isLast={!own && sends.length === 0}
            accessibilityLabel={ABOUT_LABEL}
          />
          {ownRow}
          {sends.map((sent, index) => (
            <SwipeToRemove key={sent.sender} label={t("settings.diagFamily").replace("{family}", sent.session.device.family)} onRemove={() => confirmRemove(sent)} onEmail={() => emailSent(sent)}>
              <ListRow
                icon="pulse"
                title={t("settings.diagnostics")}
                titlePill={senderPill(sent.session.device.family, sent.sender)}
                subtitleDot={fresh(sent.sentAt, now)}
                subtitle={t("settings.diagReceived").replace("{when}", stamp(sent.sentAt))}
                trailingIcon="chevron-forward"
                onPress={() => openSent(sent.sender)}
                onLongPress={() => confirmRemove(sent)}
                accessibilityActions={ROW_ACTIONS}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "remove") confirmRemove(sent);
                  if (event.nativeEvent.actionName === "email") emailSent(sent);
                }}
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
  // Phone takes 4pt more air above than sectionHeader's own; TV keeps its padding.
  header: {
    paddingTop: Platform.isTV ? 16 : 14,
  },
  gestureRoot: {
    flexShrink: 1,
  },
});
