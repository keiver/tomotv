import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { RollingFieldRow } from "@/components/settings/RollingFieldRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { StorageBar } from "@/components/storage-bar";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { clearDownloadedGuides, guideSourceStatuses, preloadGuide, subscribeGuideSources } from "@/services/externalGuide";
import { guideCacheBytes } from "@/services/guideFileCache";
import { t } from "@/services/i18n";
import { fetchTunerData, lastKnownTunerData } from "@/services/jellyfin/tunerGroups";
import { addGuideUrl } from "@/services/liveTvPreferences";
import { formatFileSize } from "@/utils/mediaInfo";
import { guideLabel, guideSourceSummary } from "@/utils/guideSources";
import { Paths } from "expo-file-system";
import { useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The guides that give channels their listings: the viewer's own, the playlists' declared ones, and their files on disk. */
export default function GuideSourcesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const preferences = useLiveTvPreferences();
  const statuses = useSyncExternalStore(subscribeGuideSources, guideSourceStatuses);
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

  const storage = <StorageBar used={bytes} free={Paths.availableDiskSpace} usedLabel={formatFileSize(bytes) || "0 KB"} hint={t("liveTv.clearGuides")} onClear={clearGuides} />;

  const sourceRow = (url: string, preferred: boolean) => {
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
        hasTVPreferredFocus={preferred}
      />
    );
  };

  return (
    <View style={settingsStyles.screenContainer}>
      <AmbientBackground />
      <ScrollView
        style={settingsStyles.scrollView}
        contentContainerStyle={[settingsStyles.scrollContent, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        automaticallyAdjustKeyboardInsets>
        <View style={settingsStyles.contentContainer}>
          {IS_TV ? (
            <View style={settingsStyles.sectionHeader}>
              <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.guideSources")}</Text>
            </View>
          ) : null}

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.yourGuides")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <SectionFooter edge="top">
              <Text style={settingsStyles.sectionNote}>{t("liveTv.guideSourcesAbout")}</Text>
            </SectionFooter>
            {/* The order guides are asked in: the viewer's own first. */}
            {[...preferences.guideUrls, ...playlistUrls].map((url, index) => sourceRow(url, index === 0))}
            <RollingFieldRow
              icon="add"
              title={t("liveTv.addGuide")}
              subtitle={invalid ? t("liveTv.guideInvalid") : t("liveTv.guideUrlHint")}
              placeholder={t("liveTv.guideUrl")}
              accessibilityLabel={t("liveTv.addGuide")}
              keyboardType="url"
              autoCapitalize="none"
              isFirst={false}
              isLast={false}
              value={draft}
              onChangeText={setDraft}
              onSave={saveDraft}
            />
            {storage}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
