import { AmbientBackground } from "@/components/ambient-background";
import { ListRow, TRAILING_SIZE } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { updateLiveTvPreferences, type ChannelSort } from "@/services/liveTvPreferences";
import { Ionicons } from "@expo/vector-icons";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** Green at rest so the choice reads without the row filling; on the gold bar it takes the bar's ink. */
function tick({ color }: { color: string }) {
  return <Ionicons name="checkmark" size={TRAILING_SIZE} color={color === COLORS.TEXT_TERTIARY ? COLORS.SUCCESS : color} />;
}

/** The channel wall's choices, two sunken lists of large rows. A root route: Menu pops it, every press applies at once. */
export default function ChannelSettingsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const preferences = useLiveTvPreferences();
  const toggleAutoUpdate = useCallback(() => updateLiveTvPreferences({ autoUpdate: !preferences.autoUpdate }), [preferences.autoUpdate]);
  const toggleFavoritesOnly = useCallback(() => updateLiveTvPreferences({ favoritesOnly: !preferences.favoritesOnly }), [preferences.favoritesOnly]);
  const pickSort = useCallback((sort: ChannelSort) => updateLiveTvPreferences({ sort }), []);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.channels")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow
              icon="refresh"
              title={t("liveTv.autoUpdate")}
              subtitle={t("liveTv.autoUpdateHint")}
              trailingIcon={preferences.autoUpdate ? tick : undefined}
              onPress={toggleAutoUpdate}
              hasTVPreferredFocus
              isFirst
            />
            <ListRow
              icon="heart"
              title={t("liveTv.favoritesOnly")}
              subtitle={t("liveTv.favoritesHint")}
              trailingIcon={preferences.favoritesOnly ? tick : undefined}
              onPress={toggleFavoritesOnly}
              isLast
            />
          </View>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("filters.sort")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow icon="list" title={t("liveTv.sortNumber")} trailingIcon={preferences.sort === "number" ? tick : undefined} onPress={() => pickSort("number")} isFirst />
            <ListRow icon="text" title={t("liveTv.sortName")} trailingIcon={preferences.sort === "name" ? tick : undefined} onPress={() => pickSort("name")} isLast />
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
