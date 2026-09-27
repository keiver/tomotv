import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { StorageBar } from "@/components/storage-bar";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { forgetGuide, guideSourceStatuses, preloadGuide, subscribeGuideSources } from "@/services/externalGuide";
import { guideFileInfo } from "@/services/guideFileCache";
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";
import { removeGuideUrl, setGuideSourceEnabled } from "@/services/liveTvPreferences";
import type { MatchVia } from "@/utils/guideMatch";
import { guideHost, guideLabel, guideSourceSummary, guideUpdatedAt } from "@/utils/guideSources";
import { formatFileSize } from "@/utils/mediaInfo";
import { Paths } from "expo-file-system";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Alert, Platform, ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

const VIA_LABEL: Record<MatchVia, StringKey> = {
  id: "liveTv.matchedById",
  tvgName: "liveTv.matchedByTvgName",
  name: "liveTv.matchedByName",
};

/** One guide: the switch that uses it, the channels it matched as a folder, and removal for the viewer's own. */
export default function GuideSourceScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { url = "" } = useLocalSearchParams<{ url?: string }>();
  const preferences = useLiveTvPreferences();
  // "Today" and "Monday" are read against the screen's opening; the file's own time is what moves.
  const [openedAt] = useState(() => Date.now());
  const statuses = useSyncExternalStore(subscribeGuideSources, guideSourceStatuses);
  const status = statuses[url];
  const enabled = !preferences.guideSourcesOff.includes(url);
  const ownGuide = preferences.guideUrls.includes(url);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a status change is when the file moves
  const file = useMemo(() => guideFileInfo(url), [url, status]);
  const matches = useMemo(() => [...(status?.matched ?? [])].sort((a, b) => a.name.localeCompare(b.name)), [status]);

  const toggle = useCallback(() => {
    setGuideSourceEnabled(url, !enabled);
    if (enabled) forgetGuide(url);
    else void preloadGuide(url);
  }, [url, enabled]);
  const remove = useCallback(
    () =>
      Alert.alert(t("liveTv.removeGuide"), guideLabel(url), [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("liveTv.removeGuide"),
          style: "destructive",
          onPress: () => {
            removeGuideUrl(url);
            forgetGuide(url);
            router.back();
          },
        },
      ]),
    [url, router],
  );

  const [expanded, setExpanded] = useState(false);
  const summary = guideSourceSummary(status, enabled, t);
  const open = expanded && matches.length > 0;

  return (
    <View style={settingsStyles.screenContainer}>
      {/* Phone: the host names the screen; the back button already says Guide sources. */}
      {IS_TV ? null : <Stack.Screen options={{ headerTitle: guideHost(url) }} />}
      <AmbientBackground />
      <ScrollView
        style={settingsStyles.scrollView}
        contentContainerStyle={[settingsStyles.scrollContent, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          {IS_TV ? (
            <View style={settingsStyles.sectionHeader}>
              <Text style={settingsStyles.sectionHeaderText} numberOfLines={1}>
                {guideLabel(url)}
              </Text>
            </View>
          ) : null}
          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.guideSourceSettings")}</Text>
          </View>
          <View style={settingsStyles.section}>
            <ListRow
              icon="checkmark-circle-outline"
              title={t("liveTv.useGuide")}
              subtitle={file ? t("liveTv.guideUpdatedAt").replace("{when}", guideUpdatedAt(file.savedAt, openedAt, t)) : undefined}
              trailingIcon={enabled ? tick : undefined}
              onPress={toggle}
              hasTVPreferredFocus
              isFirst
            />
            <ListRow
              icon="tv-outline"
              title={t("liveTv.matchedChannels")}
              subtitle={summary.subtitle}
              meter={summary.meter}
              trailingIcon={matches.length === 0 || open ? undefined : "chevron-down"}
              onPress={matches.length > 0 ? () => setExpanded(!expanded) : undefined}
              accessibilityState={{ expanded: open }}
              isLast={!ownGuide && !open}
            />
            {open
              ? matches.map((match, index) => (
                  <ListRow key={match.channelId} icon="tv-outline" title={match.name} subtitle={t(VIA_LABEL[match.via])} nested isLast={!ownGuide && index === matches.length - 1} />
                ))
              : null}
            {ownGuide ? (
              <StorageBar used={file?.bytes ?? 0} free={Paths.availableDiskSpace} usedLabel={formatFileSize(file?.bytes ?? 0) || "0 KB"} hint={t("liveTv.removeGuide")} onClear={remove} />
            ) : null}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
