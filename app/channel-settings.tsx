import { AmbientBackground } from "@/components/ambient-background";
import { DurationChips } from "@/components/settings/DurationChips";
import { DurationSlider } from "@/components/settings/DurationSlider";
import { ListRow } from "@/components/settings/ListRow";
import { tick } from "@/components/settings/tick";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, settingsStyles } from "@/components/settings/styles";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { activeGuideUrls } from "@/services/externalGuide";
import { t } from "@/services/i18n";
import { lastKnownTunerData } from "@/services/jellyfin/tunerGroups";
import { deleteGroup, RECORDING_MINUTES_OPTIONS, updateLiveTvPreferences, type ChannelGroup, type ChannelSort, type RecordingMinutes } from "@/services/liveTvPreferences";
import { durationLabel } from "@/utils/guide";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The channel wall's choices, sunken lists of large rows. A root route: Menu pops it, every press applies at once. */
export default function ChannelSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const preferences = useLiveTvPreferences();
  // Built per render, not at import: a module constant keeps the language it was first loaded in.
  const recordingOptions = RECORDING_MINUTES_OPTIONS.map((minutes) => ({ value: minutes, label: durationLabel(minutes * 60_000) }));
  const toggleAutoUpdate = useCallback(() => updateLiveTvPreferences({ autoUpdate: !preferences.autoUpdate }), [preferences.autoUpdate]);
  const toggleHideOffline = useCallback(() => updateLiveTvPreferences({ hideOffline: !preferences.hideOffline }), [preferences.hideOffline]);
  const toggleSkipCommercials = useCallback(() => updateLiveTvPreferences({ skipCommercials: !preferences.skipCommercials }), [preferences.skipCommercials]);
  const pickSort = useCallback((sort: ChannelSort) => updateLiveTvPreferences({ sort }), []);
  const pickRecordingMinutes = useCallback((recordingMinutes: RecordingMinutes) => updateLiveTvPreferences({ recordingMinutes }), []);
  const newGroup = useCallback(() => router.push("/channel-group"), [router]);
  const openGuideSources = useCallback(() => router.push("/guide-sources"), [router]);
  const activeGuides = activeGuideUrls(preferences, lastKnownTunerData()?.tvgUrls ?? []).length;
  const manageGroup = useCallback(
    (group: ChannelGroup) =>
      Alert.alert(group.name, undefined, [
        { text: t("liveTv.renameGroup"), onPress: () => router.push({ pathname: "/channel-group", params: { groupId: group.id } }) },
        { text: t("liveTv.deleteGroup"), style: "destructive", onPress: () => deleteGroup(group.id) },
        { text: t("common.cancel"), style: "cancel" },
      ]),
    [router],
  );

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}
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
            <ListRow icon="eye-off-outline" title={t("liveTv.hideOffline")} trailingIcon={preferences.hideOffline ? tick : undefined} onPress={toggleHideOffline} />
            {/* Apple TV skips through the player's own pill; the phone's player takes no custom buttons. */}
            {!IS_TV && <ListRow icon="play-skip-forward-outline" title={t("liveTv.skipCommercials")} trailingIcon={preferences.skipCommercials ? tick : undefined} onPress={toggleSkipCommercials} />}
            <ListRow
              icon="calendar-outline"
              title={t("liveTv.guideSources")}
              subtitle={activeGuides > 0 ? t("liveTv.guideSourcesActive").replace("{count}", String(activeGuides)) : t("liveTv.guideSourcesHint")}
              trailingIcon="chevron-forward"
              onPress={openGuideSources}
              isLast
            />
          </View>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.groups")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {preferences.groups.map((group, index) => (
              <ListRow key={group.id} icon="albums-outline" title={group.name} onPress={() => manageGroup(group)} isFirst={index === 0} />
            ))}
            <ListRow icon="add" title={t("liveTv.newGroup")} onPress={newGroup} isFirst={preferences.groups.length === 0} isLast />
          </View>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("filters.sort")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow icon="list" title={t("liveTv.sortNumber")} trailingIcon={preferences.sort === "number" ? tick : undefined} onPress={() => pickSort("number")} isFirst />
            <ListRow icon="text" title={t("liveTv.sortName")} trailingIcon={preferences.sort === "name" ? tick : undefined} onPress={() => pickSort("name")} isLast />
          </View>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.recordingLength")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {IS_TV ? (
              <DurationChips options={recordingOptions} selected={preferences.recordingMinutes} onSelect={pickRecordingMinutes} />
            ) : (
              <DurationSlider options={recordingOptions} selected={preferences.recordingMinutes} onSelect={pickRecordingMinutes} />
            )}
            <SectionFooter>
              <Text style={settingsStyles.sectionNote}>{t("liveTv.recordingLengthHint")}</Text>
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
