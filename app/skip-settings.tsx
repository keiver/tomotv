import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { t } from "@/services/i18n";
import { AUTO_SKIP_KINDS, type AutoSkipKind, updateUiPreferences } from "@/services/uiPreferences";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

const ROW_TITLES: Record<AutoSkipKind, Parameters<typeof t>[0]> = {
  intro: "settings.skipIntros",
  recap: "settings.skipRecaps",
  preview: "settings.skipPreviews",
  commercial: "settings.skipCommercials",
};

/** Which segments playback skips on its own. A root route: Menu pops it, every press applies at once. */
export default function SkipSettingsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { autoSkip } = useUiPreferences();
  const toggle = useCallback((kind: AutoSkipKind) => updateUiPreferences({ autoSkip: { ...autoSkip, [kind]: !autoSkip[kind] } }), [autoSkip]);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }, sideInsets(insets)]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("settings.skipAutomatically")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {AUTO_SKIP_KINDS.map((kind, index) => (
              <ListRow
                key={kind}
                icon="play-skip-forward-outline"
                title={t(ROW_TITLES[kind])}
                trailingIcon={autoSkip[kind] ? tick : undefined}
                onPress={() => toggle(kind)}
                hasTVPreferredFocus={index === 0}
                isFirst={index === 0}
                isLast={index === AUTO_SKIP_KINDS.length - 1}
                accessibilityState={{ checked: autoSkip[kind] }}
              />
            ))}
            <SectionFooter>
              <Text style={settingsStyles.sectionNote}>{t("settings.skipAutomaticallyHint")}</Text>
            </SectionFooter>
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
