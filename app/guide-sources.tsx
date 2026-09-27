import { AmbientBackground } from "@/components/ambient-background";
import { GuideSourcesConsole } from "@/components/live-tv/guide-sources-console";
import { ListRow } from "@/components/settings/ListRow";
import { RollingFieldRow } from "@/components/settings/RollingFieldRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { clearDownloadedGuides, guideSourcesBusy, guideSourceStatuses, preloadGuide, subscribeGuideSources, type GuideSourceStatus } from "@/services/externalGuide";
import { guideCacheBytes } from "@/services/guideFileCache";
import { t } from "@/services/i18n";
import { fetchTunerData, lastKnownTunerData } from "@/services/jellyfin/tunerGroups";
import { addGuideUrl } from "@/services/liveTvPreferences";
import { formatFileSize } from "@/utils/mediaInfo";
import { guideLabel, guideSourceSummary } from "@/utils/guideSources";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The guides that give channels their listings: the viewer's own, the playlists' declared ones, and their files on disk. */
export default function GuideSourcesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const preferences = useLiveTvPreferences();
  const statuses = useSyncExternalStore(subscribeGuideSources, guideSourceStatuses);
  const busy = useSyncExternalStore(subscribeGuideSources, guideSourcesBusy);
  const [declared, setDeclared] = useState<string[]>(() => lastKnownTunerData()?.tvgUrls ?? []);
  useEffect(() => {
    let cancelled = false;
    fetchTunerData()
      .then((data) => {
        if (!cancelled) setDeclared(data.tvgUrls);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const playlistUrls = useMemo(() => declared.filter((url) => !preferences.guideUrls.includes(url)), [declared, preferences.guideUrls]);
  const off = useMemo(() => new Set(preferences.guideSourcesOff), [preferences.guideSourcesOff]);

  // Read on every status change: a download or a clear moves it.
  const [clears, setClears] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- statuses and clears are the triggers, not inputs
  const bytes = useMemo(() => guideCacheBytes(), [statuses, clears]);
  const paired = useMemo(() => new Set(Object.values(statuses).flatMap((status) => status.matched.map((match) => match.channelId))).size, [statuses]);
  const activity = useMemo(() => describeActivity(Object.values(statuses)), [statuses]);

  const [draft, setDraft] = useState("");
  const [invalid, setInvalid] = useState(false);
  const saveDraft = useCallback(() => {
    if (!draft.trim()) {
      setInvalid(false);
      return;
    }
    const url = addGuideUrl(draft);
    if (!url) {
      setInvalid(true);
      return;
    }
    setDraft("");
    setInvalid(false);
    void preloadGuide(url);
  }, [draft]);

  const openGuide = useCallback((url: string) => router.push({ pathname: "/guide-source", params: { url } }), [router]);
  const clearGuides = useCallback(
    () =>
      Alert.alert(t("liveTv.clearGuides"), t("liveTv.clearGuidesConfirm"), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.delete"),
          style: "destructive",
          onPress: () => {
            clearDownloadedGuides();
            setClears((count) => count + 1);
          },
        },
      ]),
    [],
  );

  const sourceRow = (url: string, index: number, count: number, trailingField: boolean) => {
    const summary = guideSourceSummary(statuses[url], !off.has(url), t);
    return (
      <ListRow
        key={url}
        icon="calendar-outline"
        title={guideLabel(url)}
        subtitle={summary.subtitle}
        meter={summary.meter}
        trailingIcon="chevron-forward"
        onPress={() => openGuide(url)}
        hasTVPreferredFocus={index === 0 && trailingField}
        isFirst={index === 0}
        isLast={!trailingField && index === count - 1}
      />
    );
  };

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          {IS_TV ? (
            <View style={settingsStyles.sectionHeader}>
              <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.guideSources")}</Text>
            </View>
          ) : null}
          <GuideSourcesConsole figure={String(paired)} caption={t("liveTv.matchedChannels")} status={activity} busy={busy} />
          <Text style={[settingsStyles.sectionNote, styles.about]}>{t("liveTv.guideSourcesAbout")}</Text>

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.yourGuides")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {preferences.guideUrls.map((url, index) => sourceRow(url, index, preferences.guideUrls.length, true))}
            <RollingFieldRow
              icon="add"
              title={t("liveTv.addGuide")}
              subtitle={invalid ? t("liveTv.guideInvalid") : t("liveTv.guideUrlHint")}
              placeholder={t("liveTv.guideUrl")}
              accessibilityLabel={t("liveTv.addGuide")}
              keyboardType="url"
              autoCapitalize="none"
              isFirst={preferences.guideUrls.length === 0}
              value={draft}
              onChangeText={setDraft}
              onSave={saveDraft}
            />
          </View>

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.playlistGuides")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {playlistUrls.length > 0 ? (
              playlistUrls.map((url, index) => sourceRow(url, index, playlistUrls.length, false))
            ) : (
              <SectionFooter>
                <Text style={settingsStyles.sectionNote}>{t("liveTv.noPlaylistGuides")}</Text>
              </SectionFooter>
            )}
          </View>

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.guideStorage")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow icon="server-outline" title={t("liveTv.guidesOnDevice")} subtitle={formatFileSize(bytes) || "0 KB"} isFirst />
            <ListRow icon="trash-outline" tone="destructive" title={t("liveTv.clearGuides")} onPress={clearGuides} disabled={bytes === 0} isLast />
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** The console's status line: the first guide downloading or being read, else how many are ready. */
function describeActivity(statuses: readonly GuideSourceStatus[]): string | undefined {
  const working = statuses.find((status) => status.state === "downloading" || status.state === "reading");
  if (working) return `${guideSourceSummary(working, true, t).subtitle} · ${guideLabel(working.url)}`;
  const ready = statuses.filter((status) => status.state === "ready").length;
  return ready > 0 ? t("liveTv.guideSourcesActive").replace("{count}", String(ready)) : undefined;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  page: {
    alignItems: "center",
  },
  about: {
    backgroundColor: "transparent",
    marginBottom: IS_TV ? 8 : 0,
  },
});
