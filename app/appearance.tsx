import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { SwipeToRemove } from "@/components/settings/SwipeToRemove";
import { tick } from "@/components/settings/tick";
import { themeName } from "@/components/theme/theme-name";
import { ThemeSwatch } from "@/components/theme/theme-swatch";
import { useSavedThemes } from "@/hooks/useSavedThemes";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { BUILT_IN_THEMES, type CardTheme, DEFAULT_CARD_THEME } from "@/services/cardTheme";
import { t } from "@/services/i18n";
import { deleteTheme, themeSaveInFlight } from "@/services/themeLibrary";
import { getUiPreferences, updateUiPreferences } from "@/services/uiPreferences";
import { logger } from "@/utils/logger";
import { useHeaderHeight } from "expo-router/react-navigation";
import { useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const VISIBLE_THEME_ROWS = 5;

/**
 * The card theme and the canvas. A press applies at once and the page stays; the chosen saved
 * theme pressed again opens in the editor. A saved theme goes with a swipe or a long press, as a download does.
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

  const edit = (theme?: CardTheme) => router.push(theme ? { pathname: "/theme-editor", params: { id: theme.id, name: theme.name, accent: theme.accent } } : "/theme-editor");
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

  // tvOS moves focus out of a scroller only at the matching end, so the capped list pins itself
  // when focus lands on its first or last row. Same pattern as the Downloads list.
  const listRef = useRef<ScrollView>(null);
  const [listCap, setListCap] = useState<number>();
  const pinListToTop = () => listRef.current?.scrollTo({ y: 0, animated: false });
  const pinListToBottom = () => listRef.current?.scrollToEnd({ animated: false });
  const lastIndex = BUILT_IN_THEMES.length + custom.length - 1;
  const pinFor = (index: number) => (index === 0 ? pinListToTop : index === lastIndex ? pinListToBottom : undefined);

  const builtInRow = (theme: CardTheme, index: number) => {
    const chosen = theme.id === cardTheme.id;
    return (
      <ListRow
        key={theme.id}
        icon={(ink) => <ThemeSwatch color={theme.accent} ring={ink.color} />}
        title={themeName(theme)}
        trailingIcon={chosen ? tick : undefined}
        onPress={() => updateUiPreferences({ cardTheme: theme })}
        onFocus={pinFor(index)}
        hasTVPreferredFocus={chosen}
        accessibilityState={{ selected: chosen }}
        isFirst={index === 0}
      />
    );
  };

  const savedRow = ({ theme, pending }: { theme: CardTheme; pending: boolean }, index: number) => {
    const chosen = theme.id === cardTheme.id;
    return (
      <SwipeToRemove key={theme.id} label={themeName(theme)} onRemove={() => confirmRemove(theme)}>
        <ListRow
          icon={(ink) => <ThemeSwatch color={theme.accent} ring={ink.color} />}
          title={themeName(theme)}
          subtitle={pending ? t("appearance.notSynced") : theme.accent}
          trailingIcon={chosen ? tick : undefined}
          onPress={() => (chosen ? edit(theme) : updateUiPreferences({ cardTheme: theme }))}
          onLongPress={() => confirmRemove(theme)}
          accessibilityActions={[
            { name: "edit", label: t("appearance.edit") },
            { name: "remove", label: t("common.remove") },
          ]}
          onAccessibilityAction={(event) => (event.nativeEvent.actionName === "remove" ? confirmRemove(theme) : edit(theme))}
          onFocus={pinFor(BUILT_IN_THEMES.length + index)}
          hasTVPreferredFocus={chosen}
          accessibilityState={{ selected: chosen }}
        />
      </SwipeToRemove>
    );
  };

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
            {/* The swipe on a saved theme needs a gesture root. Styled: its default flex: 1 would stretch a content-sized card. */}
            <GestureHandlerRootView style={styles.gestureRoot}>
              {/* At most VISIBLE_THEME_ROWS whole rows, measured at the last visible row's bottom edge: saved rows carry a subtitle. */}
              <ScrollView ref={listRef} style={{ maxHeight: listCap }} showsVerticalScrollIndicator={false} nestedScrollEnabled focusable={false}>
                {[...BUILT_IN_THEMES.map(builtInRow), ...custom.map(savedRow)].map((row, index) =>
                  index === VISIBLE_THEME_ROWS - 1 && lastIndex >= VISIBLE_THEME_ROWS ? (
                    <View key={row.key} onLayout={({ nativeEvent: { layout } }) => setListCap(layout.y + layout.height)}>
                      {row}
                    </View>
                  ) : (
                    row
                  ),
                )}
              </ScrollView>
              {/* Not the card's last row when the footer follows it: the footer closes the card, square on top. */}
              <ListRow icon="add-circle-outline" title={t("appearance.newTheme")} trailingIcon="chevron-forward" onPress={() => edit()} isLast={!hasFooter} />
            </GestureHandlerRootView>
            {hasFooter ? (
              <SectionFooter>
                <Text style={settingsStyles.sectionNote}>{saved.status === "failed" ? t("appearance.loadFailed") : t(IS_TV ? "appearance.manageHintTv" : "appearance.manageHint")}</Text>
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
  gestureRoot: {
    flexShrink: 1,
  },
});
