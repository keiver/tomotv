import { AmbientBackground } from "@/components/ambient-background";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { forgetGuide, guideSourceStatuses, preloadGuide, subscribeGuideSources } from "@/services/externalGuide";
import { guideFileInfo } from "@/services/guideFileCache";
import { t } from "@/services/i18n";
import type { StringKey } from "@/services/i18n/strings";
import { fetchTunerData, lastKnownTunerData } from "@/services/jellyfin/tunerGroups";
import { removeGuideUrl, setGuideSourceEnabled } from "@/services/liveTvPreferences";
import type { MatchVia } from "@/utils/guideMatch";
import { guideChannelRows, guideHost, guideLabel, guideOrigin, guideSourceSummary, guideUpdatedAt } from "@/utils/guideSources";
import { logger } from "@/utils/logger";
import { formatFileSize } from "@/utils/mediaInfo";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, FlatList, Platform, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const COPIED_MS = 1500;

const VIA_LABEL: Record<MatchVia, StringKey> = {
  id: "liveTv.matchedById",
  tvgName: "liveTv.matchedByTvgName",
  name: "liveTv.matchedByName",
};

/** One guide: the switch that uses it, every channel asked of it, where it comes from, and removal for the viewer's own. */
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
  const [declaredBy, setDeclaredBy] = useState(() => lastKnownTunerData()?.tvgUrlSources ?? {});
  useEffect(() => {
    let cancelled = false;
    fetchTunerData({ revalidate: true })
      .then((data) => {
        if (!cancelled) setDeclaredBy(data.tvgUrlSources);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  const origin = useMemo(() => guideOrigin(url, preferences.guideUrls, declaredBy), [url, preferences.guideUrls, declaredBy]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a status change is when the file moves
  const file = useMemo(() => guideFileInfo(url), [url, status]);
  const channels = useMemo(() => guideChannelRows(status), [status]);

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

  const [copied, setCopied] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  // Required inside the handler: expo-clipboard's podspec is iOS and macOS only, so tvOS never loads it.
  const copy = useCallback(async (value: string) => {
    try {
      const Clipboard = await import("expo-clipboard");
      await Clipboard.setStringAsync(value);
      setCopied(value);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(null), COPIED_MS);
    } catch (error) {
      logger.warn("Clipboard unavailable", error, { service: "GuideSource" });
    }
  }, []);

  const [expanded, setExpanded] = useState(false);
  const summary = guideSourceSummary(status, enabled, t);
  const open = expanded && channels.length > 0;

  const sourceRows = [
    ...origin.playlists.map((playlist) => ({ key: playlist, icon: "list-outline" as const, title: t("liveTv.guideFromPlaylist"), value: playlist })),
    ...(origin.own ? [{ key: "own", icon: "person-outline" as const, title: t("liveTv.guideAddedByYou"), value: null }] : []),
    { key: "url", icon: "link-outline" as const, title: t("liveTv.guideAddress"), value: url },
  ];

  return (
    <View style={settingsStyles.screenContainer}>
      {/* Phone: the host names the screen; the back button already says Guide sources. */}
      {IS_TV ? null : <Stack.Screen options={{ headerTitle: guideHost(url) }} />}
      <AmbientBackground />
      {/* The channel list is the screen's own scroller: a virtualised list inside a ScrollView of
          the same axis is a dev error and keeps every row mounted. */}
      <View style={[screenStyles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + 12, paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }]}>
        <View style={[settingsStyles.contentContainer, screenStyles.column]}>
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
          <View style={[settingsStyles.section, screenStyles.card]}>
            <ListRow
              icon="checkmark-circle-outline"
              title={t("liveTv.useGuide")}
              subtitle={file ? `${t("liveTv.guideUpdatedAt").replace("{when}", guideUpdatedAt(file.savedAt, openedAt, t))} · ${formatFileSize(file.bytes) || "0 KB"}` : undefined}
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
              trailingIcon={channels.length === 0 || open ? undefined : "chevron-down"}
              onPress={channels.length > 0 ? () => setExpanded(!expanded) : undefined}
              accessibilityState={{ expanded: open }}
              isLast={!open}
            />
            {/* Capped and virtualised: a catalog playlist asks thousands of channels of one guide. */}
            {open ? (
              <FlatList
                data={channels}
                keyExtractor={channelKey}
                renderItem={({ item, index }) => (
                  <ListRow
                    icon={item.via ? "tv-outline" : "close-circle-outline"}
                    title={item.name}
                    subtitle={t(item.via ? VIA_LABEL[item.via] : "liveTv.notMatched")}
                    nested
                    isLast={index === channels.length - 1}
                  />
                )}
                style={settingsStyles.creditsScrollable}
                initialNumToRender={12}
                maxToRenderPerBatch={8}
                windowSize={5}
                showsVerticalScrollIndicator={false}
                focusable={false}
              />
            ) : null}
          </View>

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.guideOrigin")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {sourceRows.map((row, index) => (
              <ListRow
                key={row.key}
                icon={row.icon}
                title={row.value !== null && copied === row.value ? t("common.copied") : row.title}
                subtitle={row.value ?? undefined}
                subtitleLines={0}
                onPress={!IS_TV && row.value !== null ? () => void copy(row.value) : undefined}
                accessibilityHint={!IS_TV && row.value !== null ? t("liveTv.copyUrlHint") : undefined}
                isFirst={index === 0}
                isLast={index === sourceRows.length - 1}
              />
            ))}
          </View>

          {origin.own ? (
            <View style={settingsStyles.section}>
              <ListRow icon="trash-outline" tone="destructive" title={t("liveTv.removeGuide")} onPress={remove} accessibilityHint={t("liveTv.removeGuideHint")} isFirst isLast />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const channelKey = (channel: { channelId: string }) => channel.channelId;

const screenStyles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: "center",
  },
  // Shrink rather than overflow: the card with the capped list gives before Source runs off screen.
  column: {
    flexShrink: 1,
  },
  card: {
    flexShrink: 1,
  },
});
