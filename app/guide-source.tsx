import { AmbientBackground } from "@/components/ambient-background";
import { GuideSourcesConsole } from "@/components/live-tv/guide-sources-console";
import { ListRow } from "@/components/settings/ListRow";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { forgetGuide, guideSourceStatuses, preloadGuide, subscribeGuideSources, type GuideMatch } from "@/services/externalGuide";
import { guideFileInfo } from "@/services/guideFileCache";
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";
import { removeGuideUrl, setGuideSourceEnabled } from "@/services/liveTvPreferences";
import type { MatchVia } from "@/utils/guideMatch";
import { guideHost, guideLabel, guideSourceSummary, guideUpdatedAt } from "@/utils/guideSources";
import { formatFileSize } from "@/utils/mediaInfo";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { Alert, FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

const VIA_LABEL: Record<MatchVia, StringKey> = {
  id: "liveTv.matchedById",
  tvgName: "liveTv.matchedByTvgName",
  name: "liveTv.matchedByName",
};

/** One guide: its readout, the switch that uses it, removal for the viewer's own, and the channels it matched. */
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

  const details = [
    status?.channels != null
      ? t("liveTv.guideContents")
          .replace("{channels}", String(status.channels))
          .replace("{programmes}", String(status.programmes ?? 0))
      : null,
    file ? `${formatFileSize(file.bytes) || "0 KB"} · ${t("liveTv.guideUpdatedAt").replace("{when}", guideUpdatedAt(file.savedAt, openedAt, t))}` : null,
  ].filter((line): line is string => !!line);
  const busy = status?.state === "downloading" || status?.state === "reading";

  const header = (
    <View style={styles.column}>
      {IS_TV ? (
        <View style={settingsStyles.sectionHeader}>
          <Text style={settingsStyles.sectionHeaderText} numberOfLines={1}>
            {guideLabel(url)}
          </Text>
        </View>
      ) : null}
      <GuideSourcesConsole figure={String(matches.length)} caption={t("liveTv.matchedChannels")} status={guideSourceSummary(status, enabled, t).subtitle} busy={busy} details={details} />
      <View style={settingsStyles.section}>
        <ListRow
          icon="checkmark-circle-outline"
          title={t("liveTv.useGuide")}
          subtitle={IS_TV ? undefined : guideLabel(url)}
          trailingIcon={enabled ? tick : undefined}
          onPress={toggle}
          hasTVPreferredFocus
          isFirst
          isLast={!ownGuide}
        />
        {ownGuide ? <ListRow icon="trash-outline" tone="destructive" title={t("liveTv.removeGuide")} onPress={remove} isLast /> : null}
      </View>
      <View style={settingsStyles.sectionHeader}>
        <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.matchedChannels")}</Text>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Phone: the host names the screen; the back button already says Guide sources. */}
      {IS_TV ? null : <Stack.Screen options={{ headerTitle: guideHost(url) }} />}
      <AmbientBackground />
      <FlatList<GuideMatch>
        data={matches}
        keyExtractor={(match) => match.channelId}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => {
          const first = index === 0;
          const last = index === matches.length - 1;
          return (
            <View style={styles.column}>
              <View style={[styles.cell, first && styles.cellFirst, last && styles.cellLast]}>
                <ListRow icon="tv-outline" title={item.name} subtitle={t(VIA_LABEL[item.via])} isFirst={first} isLast={last} />
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={styles.column}>
            <View style={settingsStyles.section}>
              <SectionFooter>
                <Text style={settingsStyles.sectionNote}>{t("liveTv.noMatches")}</Text>
              </SectionFooter>
            </View>
          </View>
        }
        contentContainerStyle={{ paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }}
        showsVerticalScrollIndicator={false}
        initialNumToRender={20}
        windowSize={7}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Each list block is the settings column, centred on its own: the list's cells do not stretch.
  column: {
    ...settingsStyles.contentContainer,
    alignSelf: "center",
  },
  // The matched list is one card drawn cell by cell: each carries the card's surface, the ends round it.
  cell: {
    backgroundColor: settingsStyles.section.backgroundColor,
    overflow: "hidden",
  },
  cellFirst: {
    borderTopLeftRadius: settingsStyles.section.borderRadius,
    borderTopRightRadius: settingsStyles.section.borderRadius,
  },
  cellLast: {
    borderBottomLeftRadius: settingsStyles.section.borderRadius,
    borderBottomRightRadius: settingsStyles.section.borderRadius,
    marginBottom: settingsStyles.section.marginBottom,
  },
});
