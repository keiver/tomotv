import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { invalidateChannelListReads } from "@/services/jellyfin/channelEdits";
import { favoriteKey, unhideChannel, type ChannelFavorite } from "@/services/liveTvPreferences";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The channels the viewer hid; a press shows one again. A root route: Menu pops it, every press applies at once. */
export default function HiddenChannelsScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { hidden } = useLiveTvPreferences();
  const show = useCallback((entry: ChannelFavorite) => {
    unhideChannel(entry);
    invalidateChannelListReads();
  }, []);

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }, sideInsets(insets)]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.hiddenChannels")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {hidden.length === 0 ? (
              <ListRow icon="eye-off-outline" title={t("liveTv.noHiddenChannels")} disabled isFirst isLast />
            ) : (
              hidden.map((entry, index) => (
                <ListRow
                  key={favoriteKey(entry)}
                  icon="eye-outline"
                  title={entry.name}
                  subtitle={entry.number}
                  onPress={() => show(entry)}
                  hasTVPreferredFocus={index === 0}
                  isFirst={index === 0}
                  isLast={index === hidden.length - 1}
                />
              ))
            )}
            {hidden.length > 0 && (
              <SectionFooter>
                <Text style={settingsStyles.sectionNote}>{t("liveTv.hiddenChannelsHint")}</Text>
              </SectionFooter>
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
