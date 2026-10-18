import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { fetchTunerData, lastKnownTunerData, subscribeTunerDataRefreshed, tunerDataSettled } from "@/services/jellyfin/tunerGroups";
import { playlistRowSubtitle } from "@/utils/connectionLimits";
import { guideHost } from "@/utils/guideSources";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The server's tuner playlists, each with the streams its provider allows this device at once. */
export default function ConnectionLimitsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const preferences = useLiveTvPreferences();
  const [playlists, setPlaylists] = useState<string[]>(() => lastKnownTunerData()?.tunerUrls ?? []);
  // A tuner playlist that arrived after playback is listed too: read the tuners again.
  const [tunerRefreshes, setTunerRefreshes] = useState(0);
  useEffect(() => subscribeTunerDataRefreshed(() => setTunerRefreshes((count) => count + 1)), []);
  useEffect(() => {
    let cancelled = false;
    fetchTunerData({ revalidate: true })
      .then((data) => {
        if (!cancelled) setPlaylists(data.tunerUrls);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tunerRefreshes]);

  const openPlaylist = useCallback((url: string) => router.push({ pathname: "/connection-limit", params: { url } }), [router]);

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <ScrollView
        style={settingsStyles.scrollView}
        contentContainerStyle={[
          settingsStyles.scrollContent,
          { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom },
          sideInsets(insets),
        ]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.connectionLimitsHeader")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {playlists.map((url, index) => (
              <ListRow
                key={url}
                icon="git-network-outline"
                title={guideHost(url)}
                subtitle={playlistRowSubtitle(preferences.connectionLimits[url], t)}
                trailingIcon="chevron-forward"
                onPress={() => openPlaylist(url)}
                hasTVPreferredFocus={index === 0}
                isFirst={index === 0}
              />
            ))}
            <SectionFooter>
              <Text style={settingsStyles.sectionNote}>{playlists.length === 0 && tunerDataSettled() ? t("liveTv.noOrigins") : t("liveTv.connectionLimitsAbout")}</Text>
            </SectionFooter>
          </View>
        </View>
      </ScrollView>
      {/* Menu pops a pushed screen only from a focused view: with no row yet this invisible one holds focus. */}
      {IS_TV && playlists.length === 0 && (
        <Pressable isTVSelectable hasTVPreferredFocus onPress={() => {}} style={styles.focusHolder} accessibilityElementsHidden importantForAccessibility="no-hide-descendants" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  focusHolder: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
});
