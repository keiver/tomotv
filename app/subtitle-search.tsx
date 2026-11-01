import { AmbientBackground } from "@/components/ambient-background";
import { LoadingRow } from "@/components/loading-row";
import { IS_PAD, settingsStyles, sideInsets } from "@/components/settings/styles";
import { LanguageChips } from "@/components/subtitles/language-chips";
import { SubtitleJobCard } from "@/components/subtitles/subtitle-job-card";
import { SubtitleTimingRow } from "@/components/subtitles/subtitle-timing-row";
import { TakeMatchesBar } from "@/components/subtitles/take-matches-bar";
import { COLORS } from "@/constants/colors";
import { useSubtitleSearch } from "@/hooks/useSubtitleSearch";
import { useSubtitleTiming } from "@/hooks/useSubtitleTiming";
import { t } from "@/services/i18n";
import { getCachedConfig } from "@/services/jellyfin/session";
import { fetchItemDetails, fetchRecursiveDownloadables, isAudioItem, isBook, isFolder, isPhoto } from "@/services/jellyfinApi";
import { currentTextSubtitles, isCurrentPick, replacementFor, type CurrentSubtitle } from "@/services/subtitles/current";
import { languageCode, languageFor } from "@/services/subtitles/languages";
import { SUBTITLE_OFFSET_STEP_MS } from "@/services/subtitles/timing";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { useLocalSearchParams } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/** The videos a search covers: the item itself, or every video under a folder, series or season. */
export async function loadSearchItems(itemId: string): Promise<JellyfinVideoItem[]> {
  const details = await fetchItemDetails(itemId);
  if (!details) return [];
  if (!isFolder(details)) return [details];
  const leaves = await fetchRecursiveDownloadables(itemId);
  return leaves.filter((item) => !isAudioItem(item) && !isPhoto(item) && !isBook(item));
}

/** A root route: one language at a time, one job per video, each pick saved where the account allows. */
export default function SubtitleSearchScreen() {
  const { itemId, name } = useLocalSearchParams<{ itemId: string; name?: string }>();
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const [items, setItems] = useState<JellyfinVideoItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  // The subtitle a Replace press named: its language leads the search and its own copy stays out of the results.
  const [replacing, setReplacing] = useState<CurrentSubtitle | null>(null);
  const search = useSubtitleSearch(items);
  const timing = useSubtitleTiming(itemId);
  // One video's own text subtitles can be shifted or replaced here; a folder's list stays a search.
  const current = items?.length === 1 ? currentTextSubtitles(items[0], getCachedConfig().server) : [];

  useEffect(() => {
    let cancelled = false;
    loadSearchItems(itemId)
      .then((loaded) => {
        if (!cancelled) setItems(loaded);
      })
      .catch((error) => {
        logger.warn("Subtitle search could not read the item", error, { service: "Subtitles", itemId });
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId]);

  const languageName = languageFor(search.language)?.native ?? search.language;
  const busy = search.jobs.some((job) => job.status === "applying");

  return (
    <View style={styles.container}>
      <AmbientBackground />
      <ScrollView
        contentContainerStyle={[styles.page, { paddingTop: IS_TV ? 40 + insets.top : headerHeight + (IS_PAD ? 24 : 12), paddingBottom: (IS_TV ? 60 : 24) + insets.bottom }, sideInsets(insets)]}
        showsVerticalScrollIndicator={false}>
        <View style={settingsStyles.contentContainer}>
          {IS_TV ? (
            <View style={settingsStyles.sectionHeader}>
              <Text style={settingsStyles.sectionHeaderText}>{t("subtitles.title")}</Text>
            </View>
          ) : null}

          {items === null && !failed ? <LoadingRow label={t("info.loadingDetails").replace("{title}", name || t("common.thisItem"))} /> : null}
          {failed ? <Text style={styles.empty}>{t("info.couldNotReachServer")}</Text> : null}

          {items !== null ? (
            <>
              {current.length > 0 ? (
                <>
                  <View style={settingsStyles.sectionHeader}>
                    <Text style={settingsStyles.sectionHeaderText}>{t("subtitles.current")}</Text>
                  </View>
                  <View style={settingsStyles.section}>
                    {current.map((subtitle, at) => (
                      <SubtitleTimingRow
                        key={subtitle.index}
                        subtitle={subtitle}
                        offsetMs={timing.offsetFor(subtitle.index)}
                        onShift={(direction) => timing.shift(subtitle.index, direction === null ? null : direction * SUBTITLE_OFFSET_STEP_MS)}
                        onSync={timing.canSync ? () => void timing.sync(subtitle.index) : undefined}
                        syncState={timing.syncStateFor(subtitle.index)}
                        onReplace={() => {
                          setReplacing(subtitle);
                          search.setLanguage(languageCode(subtitle.language) ?? search.language);
                        }}
                        isLast={at === current.length - 1}
                      />
                    ))}
                  </View>
                </>
              ) : null}

              <View style={settingsStyles.sectionHeader}>
                <Text style={settingsStyles.sectionHeaderText}>{t("subtitles.language")}</Text>
              </View>
              <View style={[settingsStyles.section, styles.chips]}>
                <LanguageChips choices={search.choices} selected={search.language} onSelect={search.setLanguage} />
                {search.skipped > 0 ? <Text style={styles.skipped}>{t("subtitles.filesSkipped").replace("{count}", String(search.skipped)).replace("{language}", languageName)}</Text> : null}
              </View>

              <View style={settingsStyles.sectionHeader}>
                <Text style={settingsStyles.sectionHeaderText} numberOfLines={1}>
                  {name || t("subtitles.title")}
                </Text>
              </View>
              <TakeMatchesBar count={search.matches.length} busy={busy} onPress={() => void search.takeAll()} />
              {search.jobs.length === 0 && items.length > 0 ? <Text style={styles.empty}>{t("subtitles.allSubtitled").replace("{language}", languageName)}</Text> : null}
              {items.length === 0 ? <Text style={styles.empty}>{t("subtitles.noVideos")}</Text> : null}
              {search.jobs.map((job, index) => (
                <SubtitleJobCard
                  key={job.item.Id}
                  job={job}
                  alone={search.jobs.length === 1}
                  onPick={(hit) => void search.pick(index, hit, replacementFor(hit, replacing))}
                  onQueryText={(text) => search.setQueryText(index, text)}
                  isCurrent={(hit) => current.some((entry) => isCurrentPick(hit, entry))}
                />
              ))}
            </>
          ) : null}
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
  chips: {
    paddingHorizontal: IS_TV ? 32 : 20,
    paddingVertical: IS_TV ? 28 : 16,
    gap: IS_TV ? 16 : 10,
  },
  skipped: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 20 : 13,
  },
  empty: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 24 : 15,
    textAlign: "center",
    paddingVertical: IS_TV ? 40 : 24,
  },
});
