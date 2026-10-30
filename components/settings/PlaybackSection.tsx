import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { t } from "@/services/i18n";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

/** Player choices kept on this device. Shown signed in only: both pages need a library. */
export function PlaybackSection() {
  const router = useRouter();
  const openSkip = useCallback(() => router.push("/skip-settings"), [router]);
  const openLyrics = useCallback(() => router.push("/lyrics-settings"), [router]);

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.playback")}</Text>
      </View>
      <View style={settingsStyles.section}>
        <ListRow icon="play-skip-forward-outline" title={t("settings.skipAutomatically")} trailingIcon="chevron-forward" onPress={openSkip} isFirst />
        <ListRow icon="musical-notes-outline" title={t("detail.lyrics")} trailingIcon="chevron-forward" onPress={openLyrics} isLast />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // Same air above as the About header below it.
  header: {
    paddingTop: Platform.isTV ? 16 : 14,
  },
});
