import { AmbientBackground } from "@/components/ambient-background";
import { DurationChips } from "@/components/settings/DurationChips";
import { DurationSlider } from "@/components/settings/DurationSlider";
import { GuideUrlRow } from "@/components/settings/GuideUrlRow";
import { ListRow, TRAILING_SIZE } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { resetExternalGuide } from "@/services/externalGuide";
import { t } from "@/services/i18n";
import { deleteGroup, RECORDING_MINUTES_OPTIONS, updateLiveTvPreferences, type ChannelGroup, type ChannelSort, type RecordingMinutes } from "@/services/liveTvPreferences";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useState } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** Green at rest so the choice reads without the row filling; on the gold bar it takes the bar's ink. */
function tick({ color }: { color: string }) {
  return <Ionicons name="checkmark" size={TRAILING_SIZE} color={color === COLORS.TEXT_TERTIARY ? COLORS.SUCCESS : color} />;
}

/** "30m" under the hour, "2h" from it, the duration style formatDuration prints. */
function minutesLabel(minutes: number): string {
  return minutes < 60 ? `${minutes}m` : `${minutes / 60}h`;
}

const recordingOptions = RECORDING_MINUTES_OPTIONS.map((minutes) => ({ value: minutes, label: minutesLabel(minutes) }));

/** The channel wall's choices, sunken lists of large rows. A root route: Menu pops it, every press applies at once. */
export default function ChannelSettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const preferences = useLiveTvPreferences();
  const toggleAutoUpdate = useCallback(() => updateLiveTvPreferences({ autoUpdate: !preferences.autoUpdate }), [preferences.autoUpdate]);
  const toggleAutoGuide = useCallback(() => updateLiveTvPreferences({ autoGuide: !preferences.autoGuide }), [preferences.autoGuide]);
  const pickSort = useCallback((sort: ChannelSort) => updateLiveTvPreferences({ sort }), []);
  const pickRecordingMinutes = useCallback((recordingMinutes: RecordingMinutes) => updateLiveTvPreferences({ recordingMinutes }), []);
  const newGroup = useCallback(() => router.push("/channel-group"), [router]);
  const [guideUrl, setGuideUrl] = useState(preferences.guideUrl);
  // Saved on blur and Done; the guide picks it up on its next load.
  const saveGuideUrl = useCallback(() => {
    const trimmed = guideUrl.trim();
    if (trimmed === preferences.guideUrl) return;
    updateLiveTvPreferences({ guideUrl: trimmed });
    resetExternalGuide();
  }, [guideUrl, preferences.guideUrl]);
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
            <ListRow icon="earth" title={t("liveTv.autoGuide")} subtitle={t("liveTv.autoGuideHint")} trailingIcon={preferences.autoGuide ? tick : undefined} onPress={toggleAutoGuide} />
            <GuideUrlRow value={guideUrl} onChangeText={setGuideUrl} onSave={saveGuideUrl} />
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
