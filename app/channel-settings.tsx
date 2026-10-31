import { AmbientBackground } from "@/components/ambient-background";
import { promptChannelGroup } from "@/components/live-tv/channel-group-prompt";
import { DurationChips } from "@/components/settings/DurationChips";
import { DurationSlider } from "@/components/settings/DurationSlider";
import { ListRow } from "@/components/settings/ListRow";
import { tick } from "@/components/settings/tick";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { activeGuideUrls } from "@/services/externalGuide";
import { t } from "@/services/i18n";
import { lastKnownTunerData } from "@/services/jellyfin/tunerGroups";
import { deleteGroup, RECORDING_MINUTES_OPTIONS, updateLiveTvPreferences, type ChannelGroup, type ChannelSort, type RecordingMinutes } from "@/services/liveTvPreferences";
import { connectionLimitsSubtitle } from "@/utils/connectionLimits";
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
  const pickSort = useCallback((sort: ChannelSort) => updateLiveTvPreferences({ sort }), []);
  const pickRecordingMinutes = useCallback((recordingMinutes: RecordingMinutes) => updateLiveTvPreferences({ recordingMinutes }), []);
  const newGroup = useCallback(() => promptChannelGroup(), []);
  const openGuideSources = useCallback(() => router.push("/guide-sources"), [router]);
  const openSkip = useCallback(() => router.push("/skip-settings"), [router]);
  const openHidden = useCallback(() => router.push("/hidden-channels"), [router]);
  const openConnectionLimits = useCallback(() => router.push("/connection-limits"), [router]);
  const activeGuides = activeGuideUrls(preferences, lastKnownTunerData()?.tvgUrls ?? []).length;
  const manageGroup = useCallback(
    (group: ChannelGroup) =>
      Alert.alert(group.name, undefined, [
        { text: t("liveTv.renameGroup"), onPress: () => promptChannelGroup({ group }) },
        { text: t("liveTv.deleteGroup"), style: "destructive", onPress: () => deleteGroup(group.id) },
        { text: t("common.cancel"), style: "cancel" },
      ]),
    [],
  );

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }, sideInsets(insets)]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.channelsHeader")}</Text>
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
            <ListRow
              icon="eye-outline"
              title={preferences.hidden.length > 0 ? t("liveTv.hiddenChannelsCount").replace("{count}", String(preferences.hidden.length)) : t("liveTv.hiddenChannels")}
              trailingIcon="chevron-forward"
              onPress={openHidden}
            />
            <ListRow icon="play-skip-forward-outline" title={t("settings.skipAutomatically")} trailingIcon="chevron-forward" onPress={openSkip} />
            <ListRow
              icon="calendar-outline"
              title={t("liveTv.guideSources")}
              subtitle={activeGuides > 0 ? t("liveTv.guideSourcesActive").replace("{count}", String(activeGuides)) : t("liveTv.guideSourcesHint")}
              trailingIcon="chevron-forward"
              onPress={openGuideSources}
            />
            <ListRow
              icon="git-network-outline"
              title={t("liveTv.connectionLimits")}
              subtitle={connectionLimitsSubtitle(preferences.connectionLimits, t)}
              trailingIcon="chevron-forward"
              onPress={openConnectionLimits}
              isLast
            />
          </View>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.groupsHeader")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {preferences.groups.map((group, index) => (
              <ListRow key={group.id} icon="albums-outline" title={group.name} onPress={() => manageGroup(group)} isFirst={index === 0} />
            ))}
            <ListRow icon="add" title={t("liveTv.newGroup")} onPress={newGroup} isFirst={preferences.groups.length === 0} isLast />
          </View>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.sortHeader")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow icon="list" title={t("liveTv.sortNumber")} trailingIcon={preferences.sort === "number" ? tick : undefined} onPress={() => pickSort("number")} isFirst />
            <ListRow icon="text" title={t("liveTv.sortName")} trailingIcon={preferences.sort === "name" ? tick : undefined} onPress={() => pickSort("name")} isLast />
          </View>
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.recordingLengthHeader")}</Text>
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
