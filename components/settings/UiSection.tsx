import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useLanguageChoice } from "@/hooks/useLocale";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { themeName } from "@/components/theme/theme-name";
import { LANGUAGE_NAMES, t } from "@/services/i18n";
import { updateUiPreferences } from "@/services/uiPreferences";
import { useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** Interface choices kept on this device. The poster toggle covers cards only: chapter stills and channel sampling ignore it. */
export function UiSection() {
  const router = useRouter();
  const { devicePosters, cardTheme } = useUiPreferences();
  const choice = useLanguageChoice();
  const toggleDevicePosters = useCallback(() => updateUiPreferences({ devicePosters: !devicePosters }), [devicePosters]);
  const openLanguage = useCallback(() => router.push("/language"), [router]);
  const openAppearance = useCallback(() => router.push("/appearance"), [router]);
  // tvOS moves focus out of a scroller only at the matching end, so the end rows pin it.
  const listRef = useRef<ScrollView>(null);
  const [listCap, setListCap] = useState<number>();
  const pinListToTop = useCallback(() => listRef.current?.scrollTo({ y: 0, animated: false }), []);
  const pinListToBottom = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.ui")}</Text>
      </View>
      <View style={settingsStyles.section}>
        <ScrollView ref={listRef} style={IS_TV ? { maxHeight: listCap } : undefined} scrollEnabled={IS_TV} showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
          <ListRow
            icon="language"
            title={t("settings.language")}
            subtitle={choice ? LANGUAGE_NAMES[choice] : t("settings.languageSystem")}
            trailingIcon="chevron-forward"
            onPress={openLanguage}
            onFocus={IS_TV ? pinListToTop : undefined}
            isFirst
          />
          {/* On tvOS the list shows two whole rows, capped at this row's bottom edge. */}
          <View onLayout={IS_TV ? ({ nativeEvent: { layout } }) => setListCap(layout.y + layout.height) : undefined}>
            <ListRow icon="color-palette" title={t("settings.appearance")} subtitle={themeName(cardTheme)} trailingIcon="chevron-forward" onPress={openAppearance} />
          </View>
          <ListRow
            icon="image"
            title={t("settings.devicePosters")}
            subtitle={t("settings.devicePostersHint")}
            trailingIcon={devicePosters ? tick : undefined}
            onPress={toggleDevicePosters}
            onFocus={IS_TV ? pinListToBottom : undefined}
            isLast
            accessibilityState={{ checked: devicePosters }}
          />
        </ScrollView>
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
