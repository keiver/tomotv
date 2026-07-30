import { AmbientBackground } from "@/components/ambient-background";
import { FilterChip } from "@/components/filter-chip";
import { FiltersGhostTitle } from "@/components/filters-ghost-title";
import { FocusableButton } from "@/components/FocusableButton";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { fetchLibraryArtists, fetchLibraryGenres, fetchLibraryYears } from "@/services/jellyfinApi";
import { JellyfinNamedItem, LibraryFilters } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
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
  const params = useLocalSearchParams<{ folderId: string; name?: string; libraryId?: string }>();
  const libraryName = params.name ?? "";
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

  const content = (
    <View style={[styles.container, { paddingTop: insets.top + (IS_TV ? 48 : 12), paddingLeft: (IS_TV ? 80 : 20) + insets.left, paddingRight: (IS_TV ? 80 : 20) + insets.right }]}>
      {/* Ambient wash behind the chips — same component the Library/Help tabs use, pushed a
          touch harder (amber top, cool-green bottom) so the panel isn't a flat gray field. */}
      <AmbientBackground baseColor="#0D0D0F" glows={{ top: "rgba(170, 252, 7, 0.035)", bottom: "rgba(199, 79, 52, 0.05)" }} />
      {/* Library name set huge and faint in the top-right, clipped off the edge. */}
      {!!libraryName && <FiltersGhostTitle name={libraryName} />}

      <View style={styles.titleRow}>
        <Text style={styles.title}>Filters</Text>
        {!!libraryName && <Text style={styles.subtitle}>{libraryName}</Text>}
      </View>

      {/* Actions sit right under the title, above the scrollable filter content. The round close
          button is a placebo save: selections already apply live, it just confirms and closes. */}
      <View style={styles.actionRow}>
        <FocusableButton title="Clear All" variant="secondary" onPress={() => clearFilters(filterKey)} style={styles.actionButton} textStyle={styles.actionButtonText} />
        <FocusableButton
          variant="primary"
          icon={<Ionicons name="close" size={IS_TV ? 30 : 22} color="#000000" />}
          accessibilityLabel="Close filters"
          onPress={() => router.back()}
          style={styles.closeButton}
        />
      </View>

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <Text style={styles.sectionHeading}>Status</Text>
        <View style={styles.chipWrap}>
          <FilterChip label="Favorite" selected={filters.favorite} onToggle={() => update({ favorite: !filters.favorite })} hasTVPreferredFocus />
          <FilterChip label="Played" selected={filters.played} onToggle={() => update({ played: !filters.played })} />
          <FilterChip label="Unplayed" selected={filters.unplayed} onToggle={() => update({ unplayed: !filters.unplayed })} />
        </View>

        <Text style={styles.sectionHeading}>Sort</Text>
        <View style={styles.chipWrap}>
          <FilterChip label="Shuffle" selected={filters.shuffle} onToggle={() => update({ shuffle: !filters.shuffle })} />
        </View>

        {genres.length > 0 && (
          <>
            <View style={styles.sectionHeadingRow}>
              <Text style={[styles.sectionHeading, styles.sectionHeadingInline]}>Genres</Text>
              {isLoadingOptions && <ActivityIndicator size="small" color="#FFC312" style={styles.optionsLoader} />}
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
            <Text style={styles.sectionHeading}>Artists</Text>
            <View style={styles.chipWrap}>
              {artists.map((artist) => (
                <FilterChip key={artist.Id} label={artist.Name} selected={filters.artistIds.includes(artist.Id)} onToggle={() => toggleArtist(artist.Id)} />
              ))}
            </View>
          </>
        )}

        {years.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Years</Text>
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
    content
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#0D0D0F",
    paddingHorizontal: IS_TV ? 80 : 20,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: IS_TV ? 20 : 10,
    marginBottom: IS_TV ? 12 : 8,
  },
  title: {
    fontSize: IS_TV ? 38 : 24,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  subtitle: {
    fontSize: IS_TV ? 24 : 15,
    fontWeight: "500",
    color: "#8E8E93",
    flexShrink: 1,
  },
  // Clear All + Save, left-aligned under the title.
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    gap: IS_TV ? 16 : 10,
    marginTop: IS_TV ? 8 : 6,
  },
  // Compact override of FocusableButton's full-size defaults.
  actionButton: {
    minWidth: 0,
    minHeight: IS_TV ? 52 : 40,
    paddingVertical: IS_TV ? 10 : 8,
    paddingHorizontal: IS_TV ? 28 : 18,
  },
  actionButtonText: {
    fontSize: IS_TV ? 22 : 15,
  },
  // Round icon-only close: equal sides, zero padding so the circle doesn't stretch.
  closeButton: {
    minWidth: 0,
    minHeight: 0,
    width: IS_TV ? 52 : 40,
    height: IS_TV ? 52 : 40,
    paddingVertical: 0,
    paddingHorizontal: 0,
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
    color: "#8E8E93",
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
  optionsLoader: {
    margin: 0,
    alignSelf: "flex-start",
    overflow: "visible",
  },
});

export default FiltersScreen;
