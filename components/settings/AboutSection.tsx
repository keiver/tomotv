import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { ABOUT_LABEL } from "@/constants/app";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Text, View } from "react-native";

/**
 * AboutSection — the app's two reference destinations.
 *
 * `app/licenses.tsx` carries the license texts and the LGPL source offer for FFmpeg,
 * GnuTLS, libtasn1, libunistring and Nettle, and the Help tab that used to push it is
 * gone, so this row is its only entry point. `app/diagnostics.tsx` carries the version
 * and the last playback's engine log, which is what a bug report needs and what the
 * viewer otherwise has no way to read.
 *
 * Rendered by the connected Settings tab only. The logged-out view (the Settings tab
 * with no server, and the same screen Home and Search show in place of their content)
 * is the server list and nothing else, so a link under it cannot read as a second step
 * in connecting.
 *
 * Labelled "Open Source" rather than "Acknowledgements" so it matches the title the
 * destination already renders, and because that is the phrase this audience recognises.
 * Not "Disclaimers": the page disclaims nothing, it credits authors and carries the LGPL
 * written offer of source, and naming an obligation after its opposite is the kind of
 * thing that matters if anyone ever checks.
 *
 * The build's version lives in Diagnostics, where a bug report can quote it, rather than
 * on a row here that nobody came to this screen to read.
 */
export function AboutSection() {
  const router = useRouter();
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);
  const openDiagnostics = useCallback(() => router.push("/diagnostics"), [router]);

  return (
    <>
      <View style={settingsStyles.sectionHeader}>
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
          accessibilityLabel={ABOUT_LABEL}
        />
        <ListRow
          icon="pulse-outline"
          title="Diagnostics"
          subtitle="Version, and what the engine did on the last video"
          trailingIcon="chevron-forward"
          onPress={openDiagnostics}
          isLast
          accessibilityLabel="Diagnostics"
        />
      </View>
    </>
  );
}
