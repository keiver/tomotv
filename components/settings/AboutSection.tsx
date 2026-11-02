import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { t } from "@/services/i18n";

/**
 * AboutSection: the app's two reference destinations. `app/licenses.tsx` carries the license
 * texts and the LGPL source offer for FFmpeg and GNU FriBidi (constants/licenses.ts); this row
 * is its only entry point. `app/demo-credits.tsx` carries the licence and source of every item
 * on the demo server, on every server, so the credits stay reachable after the viewer leaves
 * the demo. The build's version heads the Licenses page and the Diagnostics log, rather than
 * sitting on a row here that nobody came to this screen to read.
 */
export function AboutSection() {
  const router = useRouter();
  const openLicenses = useCallback(() => router.push("/licenses"), [router]);
  const openMediaLicenses = useCallback(() => router.push("/demo-credits"), [router]);

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.about")}</Text>
      </View>
      <View style={settingsStyles.section}>
        <ListRow icon="document-text" title={t("common.openSource")} trailingIcon="chevron-forward" onPress={openLicenses} isFirst accessibilityLabel={t("common.openSource")} />
        <ListRow icon="film-outline" title={t("settings.mediaLicenses")} trailingIcon="chevron-forward" onPress={openMediaLicenses} isLast accessibilityHint={t("settings.demoCreditsHint")} />
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
