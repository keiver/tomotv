import { ListRow } from "@/components/settings/ListRow";
import { hasMoreBelow } from "@/components/settings/MoreBelowHint";
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
  const [scrollY, setScrollY] = useState(0);
  const [contentHeight, setContentHeight] = useState(0);
  // The chevron hints at rows past the window only while focus is elsewhere.
  // Counted, so a row's focus landing before its neighbour's blur cannot clear it.
  const [focusedRows, setFocusedRows] = useState(0);
  const focusedInside = focusedRows > 0;
  const enter = useCallback(() => setFocusedRows((n) => n + 1), []);
  const leave = useCallback(() => setFocusedRows((n) => Math.max(0, n - 1)), []);
  const pinListToTop = useCallback(() => {
    enter();
    listRef.current?.scrollTo({ y: 0, animated: false });
  }, [enter]);
  const pinListToBottom = useCallback(() => {
    enter();
    listRef.current?.scrollToEnd({ animated: false });
  }, [enter]);

  return (
    <>
      <View style={[settingsStyles.sectionHeader, styles.header]}>
        <Text style={settingsStyles.sectionHeaderText}>{t("settings.ui")}</Text>
      </View>
      <View style={settingsStyles.section}>
        <ScrollView
          ref={listRef}
          style={IS_TV ? { maxHeight: listCap } : undefined}
          scrollEnabled={IS_TV}
          showsVerticalScrollIndicator={false}
          nestedScrollEnabled
          focusable={false}
          scrollEventThrottle={16}
          onScroll={IS_TV ? ({ nativeEvent }) => setScrollY(nativeEvent.contentOffset.y) : undefined}
          onContentSizeChange={IS_TV ? (_, height) => setContentHeight(height) : undefined}>
          <ListRow
            icon="language"
            title={t("settings.language")}
            subtitle={choice ? LANGUAGE_NAMES[choice] : t("settings.languageSystem")}
            trailingIcon="chevron-forward"
            onPress={openLanguage}
            onFocus={IS_TV ? pinListToTop : undefined}
            onBlur={IS_TV ? leave : undefined}
            isFirst
          />
          {/* On tvOS the list shows two whole rows, capped at this row's bottom edge. */}
          <View onLayout={IS_TV ? ({ nativeEvent: { layout } }) => setListCap(layout.y + layout.height) : undefined}>
            <ListRow
              icon="color-palette"
              title={t("settings.appearance")}
              subtitle={themeName(cardTheme)}
              trailingIcon="chevron-forward"
              onPress={openAppearance}
              onFocus={IS_TV ? enter : undefined}
              onBlur={IS_TV ? leave : undefined}
              moreBelow={IS_TV ? !focusedInside && hasMoreBelow(scrollY, listCap, contentHeight) : undefined}
            />
          </View>
          <ListRow
            icon="image"
            title={t("settings.devicePosters")}
            subtitle={t("settings.devicePostersHint")}
            trailingIcon={devicePosters ? tick : undefined}
            onPress={toggleDevicePosters}
            onFocus={IS_TV ? pinListToBottom : undefined}
            onBlur={IS_TV ? leave : undefined}
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
