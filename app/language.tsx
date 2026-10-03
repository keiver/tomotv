import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useLanguageChoice } from "@/hooks/useLocale";
import { LANGUAGE_NAMES, setLanguage, SUPPORTED_LOCALES, systemLocale, t } from "@/services/i18n";
import { useHeaderHeight } from "expo-router/react-navigation";
import React from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The app's language: the device's by default, or one picked here. A press applies at once and the page stays. */
export default function LanguageScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const choice = useLanguageChoice();

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("settings.languageHeader")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow
              title={t("settings.languageSystem")}
              subtitle={LANGUAGE_NAMES[systemLocale()]}
              trailingIcon={choice === null ? tick : undefined}
              onPress={() => setLanguage(null)}
              hasTVPreferredFocus={choice === null}
              accessibilityState={{ selected: choice === null }}
              isFirst
            />
            {SUPPORTED_LOCALES.map((tag, index) => (
              <ListRow
                key={tag}
                title={LANGUAGE_NAMES[tag]}
                trailingIcon={choice === tag ? tick : undefined}
                onPress={() => setLanguage(tag)}
                hasTVPreferredFocus={choice === tag}
                accessibilityState={{ selected: choice === tag }}
                isLast={index === SUPPORTED_LOCALES.length - 1}
              />
            ))}
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
