import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { themeName } from "@/components/theme/theme-name";
import { ThemeStrip } from "@/components/theme/theme-strip";
import { useSavedThemes } from "@/hooks/useSavedThemes";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { BUILT_IN_THEMES, type CardTheme, DEFAULT_CARD_THEME } from "@/services/cardTheme";
import { t } from "@/services/i18n";
import { deleteTheme, themeSaveInFlight } from "@/services/themeLibrary";
import { getUiPreferences, updateUiPreferences } from "@/services/uiPreferences";
import { logger } from "@/utils/logger";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRouter } from "expo-router";
import React, { useEffect } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/**
 * The card theme and the canvas. A press in the strip applies at once and the page stays; the
 * chosen theme pressed again opens in the editor, and a long press asks to remove a saved one.
 */
export default function AppearanceScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const router = useRouter();
  const { cardTheme, background } = useUiPreferences();
  const saved = useSavedThemes();
  const custom: { theme: CardTheme; pending: boolean }[] = [...saved.themes.map((theme) => ({ theme, pending: false })), ...saved.pending.map((theme) => ({ theme, pending: true }))];
  const hasFooter = saved.status === "failed" || custom.length > 0;

  // A saved theme changed on another device: the copy this device draws from follows it. Not while
  // this device's own save is on its way, when the list may still hold the theme as it was.
  const latest = custom.find(({ theme }) => theme.id === cardTheme.id)?.theme;
  useEffect(() => {
    if (latest && !themeSaveInFlight() && (latest.accent !== cardTheme.accent || latest.name !== cardTheme.name)) updateUiPreferences({ cardTheme: latest });
  }, [latest, cardTheme]);

  // A built-in hands the editor only its colour: a save from it mints a new theme, never a rename of the built-in.
  const edit = (theme?: CardTheme) =>
    router.push(
      theme
        ? { pathname: "/theme-editor", params: BUILT_IN_THEMES.some((builtIn) => builtIn.id === theme.id) ? { accent: theme.accent } : { id: theme.id, name: theme.name, accent: theme.accent } }
        : "/theme-editor",
    );
  const confirmRemove = (theme: CardTheme) =>
    Alert.alert(themeName(theme), t("appearance.removeBody"), [
      { text: t("common.cancel"), style: "cancel" },
      {
        text: t("common.remove"),
        style: "destructive",
        onPress: () => {
          if (getUiPreferences().cardTheme.id === theme.id) updateUiPreferences({ cardTheme: DEFAULT_CARD_THEME });
          deleteTheme(theme.id).catch((error) => {
            logger.warn("Theme remove failed", error, { service: "Appearance" });
            Alert.alert(t("settings.couldNotRemove"), t("settings.serverRefused"));
          });
        },
      },
    ]);

  const strip = [...BUILT_IN_THEMES.map((theme) => ({ theme, saved: false, pending: false })), ...custom.map(({ theme, pending }) => ({ theme, saved: true, pending }))];

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("appearance.themesHeader")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ThemeStrip items={strip} chosenId={cardTheme.id} onPick={(theme) => updateUiPreferences({ cardTheme: theme })} onEdit={edit} onRemove={confirmRemove} />
            {/* Not the card's last row when the footer follows it: the footer closes the card, square on top. */}
            <ListRow icon="add-circle-outline" title={t("appearance.newTheme")} trailingIcon="chevron-forward" onPress={() => edit()} isLast={!hasFooter} />
            {hasFooter ? (
              <SectionFooter>
                <Text style={settingsStyles.sectionNote}>{saved.status === "failed" ? t("appearance.loadFailed") : t("appearance.manageHint")}</Text>
              </SectionFooter>
            ) : null}
          </View>

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("appearance.backgroundHeader")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {/* One canvas at a time: the Tomo light, the theme's tint on it, or folder artwork over it. */}
            <ListRow
              icon="sparkles-outline"
              title={t("appearance.backgroundTomo")}
              subtitle={t("appearance.backgroundTomoHint")}
              trailingIcon={background === "tomo" ? tick : undefined}
              onPress={() => updateUiPreferences({ background: "tomo" })}
              accessibilityState={{ selected: background === "tomo" }}
              isFirst
            />
            <ListRow
              icon="color-palette-outline"
              title={t("appearance.backgroundAccent")}
              subtitle={t("appearance.backgroundAccentHint")}
              trailingIcon={background === "accent" ? tick : undefined}
              onPress={() => updateUiPreferences({ background: "accent" })}
              accessibilityState={{ selected: background === "accent" }}
            />
            <ListRow
              icon="images-outline"
              title={t("appearance.backgroundArtwork")}
              subtitle={t("appearance.backgroundArtworkHint")}
              trailingIcon={background === "artwork" ? tick : undefined}
              onPress={() => updateUiPreferences({ background: "artwork" })}
              accessibilityState={{ selected: background === "artwork" }}
              isLast
            />
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
