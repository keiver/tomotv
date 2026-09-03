import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { ABOUT_LABEL } from "@/constants/app";
import { useSentSessions } from "@/hooks/useSentSessions";
import { savedAt } from "@/services/diagnosticsLog";
import { readLastSession } from "@/services/playbackProbe";
import { THIS_DEVICE } from "@/services/playbackStory";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

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
  /** Logged out there is no playback to read, so the row is hidden rather than left empty. */
  showDiagnostics: boolean;
}

const stamp = (t: number) => new Date(t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" });

export function AboutSection({ showDiagnostics }: AboutSectionProps) {
  const router = useRouter();
  const own = showDiagnostics ? readLastSession() : null;
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);
  const openDiagnostics = useCallback(() => router.push("/diagnostics"), [router]);
  const sends = useSentSessions();
  const openSent = useCallback((sender: string) => router.push({ pathname: "/diagnostics", params: { sender } }), [router]);

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>ABOUT TOMO TV</Text>
      </View>
      <View style={settingsStyles.section}>
        <ListRow
          icon="document-text-outline"
          title={ABOUT_LABEL}
          subtitle="Licenses and credits for the projects the engine is built on"
          trailingIcon="chevron-forward"
          onPress={openLicenses}
          isFirst
          isLast={!showDiagnostics && sends.length === 0}
          accessibilityLabel={ABOUT_LABEL}
        />
        {showDiagnostics && (
          <ListRow
            icon="pulse-outline"
            title="Diagnostics"
            titlePill={THIS_DEVICE}
            subtitle={own ? `Saved ${stamp(savedAt(own))}` : "Nothing has played yet"}
            trailingIcon="chevron-forward"
            onPress={openDiagnostics}
            isLast={sends.length === 0}
            accessibilityLabel={`Diagnostics, this ${THIS_DEVICE}`}
          />
        )}
        {sends.map((sent, index) => (
          <ListRow
            key={sent.sender}
            icon="pulse-outline"
            title="Diagnostics"
            titlePill={sent.device}
            subtitle={`Received ${stamp(sent.sentAt)}`}
            trailingIcon="chevron-forward"
            onPress={() => openSent(sent.sender)}
            isLast={index === sends.length - 1}
            accessibilityLabel={`Diagnostics from your ${sent.device}, received ${stamp(sent.sentAt)}`}
          />
        ))}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // Phone takes 4pt more air above than sectionHeader's own; TV keeps its padding.
  header: {
    paddingTop: Platform.isTV ? 16 : 14,
  },
});
