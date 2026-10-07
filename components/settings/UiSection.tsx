import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useLanguageChoice } from "@/hooks/useLocale";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { themeName } from "@/components/theme/theme-name";
import { LANGUAGE_NAMES, t } from "@/services/i18n";
import { updateUiPreferences } from "@/services/uiPreferences";
import { useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

/** Interface choices kept on this device. The poster toggle covers cards only: chapter stills and channel sampling ignore it. */
export function UiSection() {
  const router = useRouter();
  const { devicePosters, cardTheme } = useUiPreferences();
  const choice = useLanguageChoice();
  const toggleDevicePosters = useCallback(() => updateUiPreferences({ devicePosters: !devicePosters }), [devicePosters]);
  const openLanguage = useCallback(() => router.push("/language"), [router]);
  const openAppearance = useCallback(() => router.push("/appearance"), [router]);

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.ui")}</Text>
      </View>
      <View style={settingsStyles.section}>
        <ListRow
          icon="language"
          title={t("settings.language")}
          subtitle={choice ? LANGUAGE_NAMES[choice] : t("settings.languageSystem")}
          trailingIcon="chevron-forward"
          onPress={openLanguage}
          isFirst
        />
        <ListRow icon="color-palette" title={t("settings.appearance")} subtitle={themeName(cardTheme)} trailingIcon="chevron-forward" onPress={openAppearance} />
        <ListRow
          icon="image"
          title={t("settings.devicePosters")}
          subtitle={t("settings.devicePostersHint")}
          trailingIcon={devicePosters ? tick : undefined}
          onPress={toggleDevicePosters}
          isLast
          accessibilityState={{ checked: devicePosters }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  // Matches the About header below it.
  header: {
    paddingTop: Platform.isTV ? 16 : 14,
  },
});
