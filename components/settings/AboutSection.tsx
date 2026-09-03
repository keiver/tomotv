import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { ABOUT_LABEL } from "@/constants/app";
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
 * sitting on a row here that nobody came to this screen to read.
 */
interface AboutSectionProps {
  /** Logged out there is no playback to read, so the row is hidden rather than left empty. */
  showDiagnostics: boolean;
}

export function AboutSection({ showDiagnostics }: AboutSectionProps) {
  const router = useRouter();
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);
  const openDiagnostics = useCallback(() => router.push("/diagnostics"), [router]);

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
          isLast={!showDiagnostics}
          accessibilityLabel={ABOUT_LABEL}
        />
        {showDiagnostics && (
          <ListRow
            icon="pulse-outline"
            title="Diagnostics"
            subtitle="Version, and what the engine did on the last video"
            trailingIcon="chevron-forward"
            onPress={openDiagnostics}
            isLast
            accessibilityLabel="Diagnostics"
          />
        )}
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
