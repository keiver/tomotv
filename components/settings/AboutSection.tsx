import { ListRow } from "@/components/settings/ListRow";
import { SwipeToRemove } from "@/components/settings/SwipeToRemove";
import { settingsStyles } from "@/components/settings/styles";
import { ABOUT_LABEL } from "@/constants/app";
import { useLastSession } from "@/hooks/useLastSession";
import { useSentSessions } from "@/hooks/useSentSessions";
import { removeSend } from "@/services/diagnosticsInbox";
import { buildLog, logText, savedAt } from "@/services/diagnosticsLog";
import type { SentSession } from "@/services/diagnosticsOutbox";
import { mailLog } from "@/services/diagnosticsShare";
import { clearLastSession, type PlaybackSession } from "@/services/playbackProbe";
import { describePlayback, THIS_DEVICE, type DeviceName } from "@/services/playbackStory";
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { logger } from "@/utils/logger";
import { Alert, Platform, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

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
/** A session this young wears the unread dot: it is the one the viewer just made or was just sent. */
const FRESH_MS = 5 * 60 * 1000;
const fresh = (at: number, now: number) => now - at < FRESH_MS;
/** This device is named as such; two Apple TVs read alike, so a sender is its glyph and the head of its id. */
const OWN_PILL = { icon: PLATFORM_ICON[THIS_DEVICE], label: `This ${THIS_DEVICE}` };
const senderPill = (device: DeviceName, deviceId: string) => ({ icon: PLATFORM_ICON[device], label: deviceId.split("-")[0].toUpperCase() });
const ROW_ACTIONS = [
  { name: "email", label: "Email" },
  { name: "remove", label: "Remove" },
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
  // The clock the unread dots read, taken on each look at the screen rather than on each render.
  const [now, setNow] = useState(() => Date.now());
  useFocusEffect(useCallback(() => setNow(Date.now()), []));
  const openSent = useCallback((sender: string) => router.push({ pathname: "/diagnostics", params: { sender } }), [router]);
  const emailOwn = useCallback((session: PlaybackSession) => {
    const text = logText(buildLog(session, session), describePlayback(session, THIS_DEVICE, true));
    void mailLog(text, `Tomo TV diagnostics, ${THIS_DEVICE}`).catch((error) => logger.warn("Mail unavailable", error, { service: "AboutSection" }));
  }, []);
  const confirmRemoveOwn = useCallback(() => {
    Alert.alert(`Remove this ${THIS_DEVICE}'s diagnostics?`, `It is deleted from this ${THIS_DEVICE}.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: clearLastSession },
    ]);
  }, []);
  const emailSent = useCallback((sent: SentSession) => {
    const text = logText(buildLog(sent.session, sent.session), describePlayback(sent.session, sent.device, false));
    void mailLog(text, `Tomo TV diagnostics, ${sent.device}`).catch((error) => logger.warn("Mail unavailable", error, { service: "AboutSection" }));
  }, []);
  const confirmRemove = useCallback((sent: SentSession) => {
    Alert.alert(`Remove ${sent.device} diagnostics?`, "It is deleted from your Jellyfin server, for every device on this account.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () =>
          void removeSend(sent.sender).catch((error) => {
            logger.warn("Diagnostics remove failed", error, { service: "AboutSection" });
            Alert.alert("Could not remove it", "Your server did not take the change. Try again.");
          }),
      },
    ]);
  }, []);

  const ownRow = own && (
    <SwipeToRemove label={`this ${THIS_DEVICE}'s diagnostics`} onRemove={confirmRemoveOwn} onEmail={() => emailOwn(own)}>
      <ListRow
        icon="pulse-outline"
        title="Diagnostics"
        titlePill={OWN_PILL}
        unread={fresh(savedAt(own), now)}
        subtitle={`Saved ${stamp(savedAt(own))}`}
        trailingIcon="chevron-forward"
        onPress={openDiagnostics}
        onLongPress={confirmRemoveOwn}
        accessibilityActions={ROW_ACTIONS}
        onAccessibilityAction={(event) => {
          if (event.nativeEvent.actionName === "remove") confirmRemoveOwn();
          if (event.nativeEvent.actionName === "email") emailOwn(own);
        }}
        isLast={sends.length === 0}
        accessibilityLabel={`Diagnostics, this ${THIS_DEVICE}, saved ${stamp(savedAt(own))}`}
        accessibilityHint="Swipe left or press and hold to remove."
      />
    </SwipeToRemove>
  );

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>ABOUT TOMO TV</Text>
      </View>
      <View style={settingsStyles.section}>
        {/* The swipe on a diagnostics row needs a gesture root, and the Settings tab has none. Styled,
            because the root's default is flex: 1 and this sits in a content-sized card. */}
        <GestureHandlerRootView style={styles.gestureRoot}>
          <ListRow
            icon="document-text-outline"
            title={ABOUT_LABEL}
            subtitle="Licenses and credits"
            trailingIcon="chevron-forward"
            onPress={openLicenses}
            isFirst
            isLast={!own && sends.length === 0}
            accessibilityLabel={ABOUT_LABEL}
          />
          {ownRow}
          {sends.map((sent, index) => (
            <SwipeToRemove key={sent.sender} label={`${sent.device} diagnostics`} onRemove={() => confirmRemove(sent)} onEmail={() => emailSent(sent)}>
              <ListRow
                icon="pulse-outline"
                title="Diagnostics"
                titlePill={senderPill(sent.device, sent.sender)}
                unread={fresh(sent.sentAt, now)}
                subtitle={`Received ${stamp(sent.sentAt)}`}
                trailingIcon="chevron-forward"
                onPress={() => openSent(sent.sender)}
                onLongPress={() => confirmRemove(sent)}
                accessibilityActions={ROW_ACTIONS}
                onAccessibilityAction={(event) => {
                  if (event.nativeEvent.actionName === "remove") confirmRemove(sent);
                  if (event.nativeEvent.actionName === "email") emailSent(sent);
                }}
                isLast={index === sends.length - 1}
                accessibilityLabel={`Diagnostics from your ${sent.device}, received ${stamp(sent.sentAt)}`}
                accessibilityHint="Swipe left or press and hold to remove."
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
