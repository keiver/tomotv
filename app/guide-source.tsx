import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { ListRow } from "@/components/settings/ListRow";
import { settingsStyles } from "@/components/settings/styles";
import { tick } from "@/components/settings/tick";
import { COLORS } from "@/constants/colors";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { forgetGuide, guideSourceStatuses, preloadGuide, subscribeGuideSources } from "@/services/externalGuide";
import { guideFileInfo } from "@/services/guideFileCache";
import { t } from "@/services/i18n";
import { fetchTunerData, lastKnownTunerData } from "@/services/jellyfin/tunerGroups";
import { removeGuideUrl, setGuideSourceEnabled } from "@/services/liveTvPreferences";
import { guideChannelRows, guideHost, guideLabel, guideOrigin, guideSourceSummary, guideUpdatedAt } from "@/utils/guideSources";
import { logger } from "@/utils/logger";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter, type NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Alert, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const COPIED_MS = 1500;

/** One guide: the switch that uses it, its matched channels, where it comes from, and removal for the viewer's own. */
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

  const summary = guideSourceSummary(status, enabled, t);

  const sourceRows = [
    ...origin.playlists.map((playlist) => ({ key: playlist, icon: "list-outline" as const, title: t("liveTv.guideFromPlaylist"), value: playlist })),
    ...(origin.own ? [{ key: "own", icon: "person-outline" as const, title: t("liveTv.guideAddedByYou"), value: null }] : []),
    { key: "url", icon: "link-outline" as const, title: t("liveTv.guideAddress"), value: url },
  ];

  // Phone: the host names the screen; the back button already says Guide sources.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      headerTitle: guideHost(url),
      unstable_headerRightItems: () =>
        origin.own
          ? [
              {
                type: "custom",
                element: (
                  <FocusableButton
                    title={t("liveTv.removeGuide")}
                    variant="link"
                    icon={<Ionicons name="trash-outline" size={16} color={COLORS.DESTRUCTIVE_SOFT} />}
                    textStyle={screenStyles.removeText}
                    onPress={remove}
                    accessibilityHint={t("liveTv.removeGuideHint")}
                  />
                ),
              },
            ]
          : [],
    }),
    [url, origin.own, remove],
  );

  return (
    <View style={settingsStyles.screenContainer}>
      {IS_TV ? null : <Stack.Screen options={screenOptions} />}
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
              trailingIcon={channels.length === 0 ? undefined : "chevron-forward"}
              onPress={channels.length > 0 ? () => router.push({ pathname: "/guide-channels", params: { url } }) : undefined}
              isLast
            />
          </View>

          <View style={settingsStyles.sectionHeader}>
            <Text style={settingsStyles.sectionHeaderText}>{t("liveTv.guideOrigin")}</Text>
          </View>
          <View style={settingsStyles.section}>
            {sourceRows.map((row, index) => {
              const copyable = !IS_TV && row.value !== null;
              return (
                <ListRow
                  key={row.key}
                  icon={row.icon}
                  title={row.value !== null && copied === row.value ? t("common.copied") : row.title}
                  subtitle={row.value ?? undefined}
                  subtitleLines={0}
                  trailingIcon={copyable ? (copied === row.value ? "checkmark" : "copy-outline") : undefined}
                  onPress={copyable ? () => void copy(row.value as string) : undefined}
                  accessibilityHint={copyable ? t("liveTv.copyUrlHint") : undefined}
                  isFirst={index === 0}
                  isLast={index === sourceRows.length - 1}
                />
              );
            })}
          </View>

          {IS_TV && origin.own ? (
            <View style={settingsStyles.section}>
              <ListRow icon="trash-outline" tone="destructive" title={t("liveTv.removeGuide")} onPress={remove} accessibilityHint={t("liveTv.removeGuideHint")} isFirst isLast />
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const screenStyles = StyleSheet.create({
  removeText: {
    color: COLORS.DESTRUCTIVE_SOFT,
  },
});
