import { FilterChip } from "@/components/filter-chip";
import { FiltersGhostMark } from "@/components/filters-ghost-mark";
import { FiltersScope } from "@/components/filters-scope";
import { GlassButton } from "@/components/glass-button";
import { LoadingRow } from "@/components/loading-row";
import { COLORS } from "@/constants/colors";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { fetchLibraryArtists, fetchLibraryGenres, fetchLibraryYears } from "@/services/jellyfinApi";
import { JellyfinNamedItem, LibraryFilters } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import type { NativeStackNavigationOptions } from "expo-router";
import { useHeaderHeight } from "expo-router/react-navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from "react-native";

import { t } from "@/services/i18n";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/**
 * Full-screen Filters panel for one library, pushed as a real route so the Apple TV Menu
 * button dismisses it natively (stack rule: no custom menu handlers). Selections apply
 * immediately to LibraryFiltersContext; the folder screen refetches on return.
 */
function FiltersScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Zero on TV, where the route hides the bar. On phone it carries the safe-area top with it,
  // so the content clears a transparent bar the screen still paints under.
  const headerHeight = useHeaderHeight();
  const params = useLocalSearchParams<{ folderId: string; name?: string; libraryId?: string; libraryName?: string }>();
  const folderName = params.name ?? "";
  // The panel names the filter's scope, which is the library root, not the folder standing under it.
  const libraryName = params.libraryName ?? folderName;
  // Options AND selection key off the library root so the list and the active filters are shared
  // everywhere inside the library (a sub-folder inherits the library's filters, not a blank set).
  const filterKey = params.libraryId ?? params.folderId;

  const { getFilters, setFilters, clearFilters } = useLibraryFilters();
  const filters = getFilters(filterKey);

  const [genres, setGenres] = useState<string[]>([]);
  const [artists, setArtists] = useState<JellyfinNamedItem[]>([]);
  const [years, setYears] = useState<number[]>([]);
  const [isLoadingOptions, setIsLoadingOptions] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // Load each list independently: a failed call must not blank the others.
    Promise.allSettled([fetchLibraryGenres(filterKey), fetchLibraryArtists(filterKey), fetchLibraryYears(filterKey)]).then(([genresResult, artistsResult, yearsResult]) => {
      if (cancelled) return;
      if (genresResult.status === "fulfilled") {
        setGenres(genresResult.value);
      } else {
        logger.warn("Failed to load genres for filters panel", genresResult.reason, { service: "FiltersScreen", filterKey });
      }
      if (artistsResult.status === "fulfilled") {
        setArtists(artistsResult.value);
      } else {
        logger.warn("Failed to load artists for filters panel", artistsResult.reason, { service: "FiltersScreen", filterKey });
      }
      if (yearsResult.status === "fulfilled") {
        setYears(yearsResult.value);
      } else {
        logger.warn("Failed to load years for filters panel", yearsResult.reason, { service: "FiltersScreen", filterKey });
      }
      setIsLoadingOptions(false);
    });
    return () => {
      cancelled = true;
    };
  }, [filterKey]);

  const update = useCallback((next: Partial<LibraryFilters>) => setFilters(filterKey, { ...filters, ...next }), [setFilters, filterKey, filters]);

  const toggleGenre = useCallback(
    (name: string) => {
      update({ genres: filters.genres.includes(name) ? filters.genres.filter((g) => g !== name) : [...filters.genres, name] });
    },
    [update, filters.genres],
  );

  const toggleArtist = useCallback(
    (id: string) => {
      update({ artistIds: filters.artistIds.includes(id) ? filters.artistIds.filter((a) => a !== id) : [...filters.artistIds, id] });
    },
    [update, filters.artistIds],
  );

  const toggleYear = useCallback(
    (year: number) => {
      update({ years: filters.years.includes(year) ? filters.years.filter((y) => y !== year) : [...filters.years, year] });
    },
    [update, filters.years],
  );

  // TV only: clearing is the last thing you want from the panel, so it doubles as the exit.
  const clearAllAndClose = useCallback(() => {
    clearFilters(filterKey);
    router.back();
  }, [clearFilters, filterKey, router]);

  // Phone only: the bar carries the whole header. Back names the panel, the title names the folder
  // (same shape as a folder level), and Clear All is a real UIBarButtonItem.
  // Memoised as one object: Stack.Screen keys its own memo on the identity of `options`.
  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      title: folderName,
      headerBackTitle: t("filters.title"),
      unstable_headerRightItems: () => [
        { type: "button", label: t("filters.clearAll"), tintColor: COLORS.ACCENT, accessibilityLabel: t("filters.clearAllHint"), onPress: () => clearFilters(filterKey) },
      ],
    }),
    [folderName, clearFilters, filterKey],
  );

  const content = (
    <View style={[styles.container, { paddingTop: IS_TV ? insets.top + 48 : headerHeight + 12, paddingLeft: (IS_TV ? 80 : 20) + insets.left, paddingRight: (IS_TV ? 80 : 20) + insets.right }]}>
      {/* BEFORE every focusable below: on tvOS a view drawn above a focusable occludes it. */}
      <FiltersGhostMark />

      {/* TV keeps its actions on the screen, where the remote can reach them: the round close is a
          placebo save (selections already apply live). Phone takes both from the navigation bar,
          and reads the title off it too. */}
      {IS_TV && (
        <>
          <View style={styles.actionRow}>
            <GlassButton
              icon={<Ionicons name="close" size={30} color={COLORS.ACCENT} />}
              accessibilityLabel={t("filters.close")}
              onPress={() => router.back()}
              style={styles.closeButton}
              hasTVPreferredFocus
            />
            <GlassButton title={t("filters.clearAll")} onPress={clearAllAndClose} />
          </View>
          <View style={styles.heading}>
            <Text style={styles.title}>{t("filters.title")}</Text>
            {!!libraryName && <FiltersScope libraryName={libraryName} />}
          </View>
        </>
      )}

      {/* Phone and iPad read the title off the nav bar, so the scope line rides under it here. */}
      {!IS_TV && !!libraryName && (
        <View style={styles.scopePhone}>
          <FiltersScope libraryName={libraryName} />
        </View>
      )}

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeading}>{t("filters.status")}</Text>
        <View style={styles.chipWrap}>
          <FilterChip label={t("filters.favorite")} selected={filters.favorite} onToggle={() => update({ favorite: !filters.favorite })} />
          <FilterChip label={t("filters.played")} selected={filters.played} onToggle={() => update({ played: !filters.played })} />
          <FilterChip label={t("filters.unplayed")} selected={filters.unplayed} onToggle={() => update({ unplayed: !filters.unplayed })} />
        </View>

        <Text style={styles.sectionHeading}>{t("filters.sort")}</Text>
        <View style={styles.chipWrap}>
          <FilterChip label={t("filters.shuffle")} selected={filters.shuffle} onToggle={() => update({ shuffle: !filters.shuffle })} />
        </View>

        {genres.length > 0 && (
          <>
            <View style={styles.sectionHeadingRow}>
              <Text style={[styles.sectionHeading, styles.sectionHeadingInline]}>{t("filters.genres")}</Text>
              {isLoadingOptions && <LoadingRow label={t("filters.loading")} />}
            </View>
            <View style={styles.chipWrap}>
              {genres.map((genre) => (
                <FilterChip key={genre} label={genre} selected={filters.genres.includes(genre)} onToggle={() => toggleGenre(genre)} />
              ))}
            </View>
          </>
        )}

        {artists.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>{t("filters.artists")}</Text>
            <View style={styles.chipWrap}>
              {artists.map((artist) => (
                <FilterChip key={artist.Id} label={artist.Name} selected={filters.artistIds.includes(artist.Id)} onToggle={() => toggleArtist(artist.Id)} />
              ))}
            </View>
          </>
        )}

        {years.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>{t("filters.years")}</Text>
            <View style={styles.chipWrap}>
              {years.map((year) => (
                <FilterChip key={year} label={String(year)} selected={filters.years.includes(year)} onToggle={() => toggleYear(year)} />
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );

  // Presented as a root route (app/filters.tsx) that covers the tabs, so the native tab bar isn't
  // on screen to steal focus — the same pattern as player/photo-viewer. trapFocusUp is kept as a
  // belt-and-suspenders guard for the top row; no holder/trap gymnastics are needed here.
  return IS_TV ? (
    <TVFocusGuideView style={styles.flex} trapFocusUp>
      {content}
    </TVFocusGuideView>
  ) : (
    <>
      <Stack.Screen options={screenOptions} />
      {content}
    </>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // Horizontal padding lives in the inline style (safe-area-aware paddingLeft/Right).
  container: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND_DEEP,
  },
  // Same inset as scrollContent so the heading lines up with the section headings under it.
  heading: {
    marginTop: 28,
    paddingHorizontal: 10,
  },
  title: {
    fontSize: 38,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
  },
  // TV only: close at the leading edge, Clear All pushed to the trailing edge.
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
  },
  // Round icon-only close: equal sides, zero padding so the circle doesn't stretch.
  closeButton: {
    minWidth: 0,
    minHeight: 0,
    width: 52,
    height: 52,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  // Phone/iPad scope line, inset to line up with the section headings under it.
  scopePhone: {
    paddingHorizontal: 5,
    marginBottom: 4,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: IS_TV ? 80 : 40,
    paddingHorizontal: IS_TV ? 10 : 5,
  },
  sectionHeading: {
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_TERTIARY,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: IS_TV ? 32 : 22,
    marginBottom: IS_TV ? 16 : 10,
    overflow: "visible",
  },
  // Genres heading + inline loader. The loader is a view, so it must live in a View, not nested in
  // <Text>. Carry the section's vertical spacing here and zero it on the inline text so the spinner
  // sits centered against the word, not against the text's asymmetric margins.
  sectionHeadingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 12 : 8,
    marginTop: IS_TV ? 32 : 22,
    marginBottom: IS_TV ? 16 : 10,
  },
  sectionHeadingInline: {
    marginTop: 0,
    marginBottom: 0,
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: IS_TV ? 14 : 8,
  },
});

export default FiltersScreen;
