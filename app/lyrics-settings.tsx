import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { t } from "@/services/i18n";
import { listenerAvailable, listenHintKey } from "@/services/lyrics/listener";
import { canManageLyrics } from "@/services/lyrics/upload";
import { updateUiPreferences } from "@/services/uiPreferences";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** Where a song's lyrics may come from. A root route: Menu pops it, every press applies at once. */
export default function LyricsSettingsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { showLyrics, findLyrics, listenForLyrics, saveLyrics } = useUiPreferences();
  // A device that cannot listen shows the row off and inert; saving is left out for an account that may not.
  const [canListen, setCanListen] = useState(false);
  const [canSave, setCanSave] = useState(false);
  useEffect(() => {
    let mounted = true;
    void listenerAvailable().then((available) => mounted && setCanListen(available));
    void canManageLyrics().then((allowed) => mounted && setCanSave(allowed));
    return () => {
      mounted = false;
    };
  }, []);
  const toggleShow = useCallback(() => updateUiPreferences({ showLyrics: !showLyrics }), [showLyrics]);
  const toggleFind = useCallback(() => updateUiPreferences({ findLyrics: !findLyrics }), [findLyrics]);
  const toggleListen = useCallback(() => updateUiPreferences({ listenForLyrics: !listenForLyrics }), [listenForLyrics]);
  const toggleSave = useCallback(() => updateUiPreferences({ saveLyrics: !saveLyrics }), [saveLyrics]);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }, sideInsets(insets)]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("detail.lyrics")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow
              icon="musical-notes-outline"
              title={t("settings.showLyrics")}
              trailingIcon={showLyrics ? tick : undefined}
              onPress={toggleShow}
              hasTVPreferredFocus
              isFirst
              accessibilityState={{ checked: showLyrics }}
            />
            <ListRow
              icon="search"
              title={t("lyrics.find")}
              subtitle={t("lyrics.findHint")}
              trailingIcon={findLyrics ? tick : undefined}
              onPress={toggleFind}
              accessibilityState={{ checked: findLyrics }}
            />
            <ListRow
              icon="ear-outline"
              title={t("lyrics.listen")}
              subtitle={t(listenHintKey(canListen, IS_TV))}
              trailingIcon={canListen && listenForLyrics ? tick : undefined}
              onPress={toggleListen}
              disabled={!canListen}
              isLast={!canSave}
              accessibilityState={{ checked: canListen && listenForLyrics, disabled: !canListen }}
            />

            {canSave && (
              <ListRow icon="cloud-upload-outline" title={t("lyrics.save")} trailingIcon={saveLyrics ? tick : undefined} onPress={toggleSave} isLast accessibilityState={{ checked: saveLyrics }} />
            )}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    alignItems: "center",
  },
});
