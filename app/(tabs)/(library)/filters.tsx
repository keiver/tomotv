import { FilterChip } from "@/components/filter-chip";
import { FocusableButton } from "@/components/FocusableButton";
import { useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { fetchLibraryArtists, fetchLibraryGenres, fetchLibraryYears } from "@/services/jellyfinApi";
import { JellyfinNamedItem, LibraryFilters } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TVFocusGuideView, View } from "react-native";
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
    <View style={[styles.container, { paddingTop: insets.top + (IS_TV ? 48 : 12) }]}>
      {/* Touch gets an explicit back row; on TV the Menu button pops the route natively. */}
      {!IS_TV && (
        <Pressable onPress={() => router.back()} style={styles.touchBack} accessibilityRole="button" accessibilityLabel="Done">
          <Ionicons name="chevron-back" size={22} color="#FFC312" />
          <Text style={styles.touchBackText}>Done</Text>
        </Pressable>
      )}

      <View style={styles.titleRow}>
        <Text style={styles.title}>Filters</Text>
        {!!libraryName && <Text style={styles.subtitle}>{libraryName}</Text>}
      </View>

      {/* Clear All sits right under the title, above the scrollable filter content. */}
      <FocusableButton title="Clear All" variant="secondary" onPress={() => clearFilters(filterKey)} style={styles.clearButton} textStyle={styles.clearButtonText} />

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

        {isLoadingOptions && <ActivityIndicator size="small" color="#FFC312" style={styles.optionsLoader} />}

        {genres.length > 0 && (
          <>
            <Text style={styles.sectionHeading}>Genres</Text>
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

  // Same hazard as the folder grid: Up-focus escaping to the tab bar pops the nested stack.
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
    backgroundColor: "#1C1C1E",
    paddingHorizontal: IS_TV ? 80 : 20,
  },
  touchBack: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
  },
  touchBackText: {
    color: "#FFC312",
    fontSize: 17,
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
  // Compact override of FocusableButton's full-size defaults; left-aligned under the title.
  clearButton: {
    alignSelf: "flex-start",
    minWidth: 0,
    minHeight: IS_TV ? 52 : 40,
    marginTop: IS_TV ? 8 : 6,
    paddingVertical: IS_TV ? 10 : 8,
    paddingHorizontal: IS_TV ? 28 : 18,
  },
  clearButtonText: {
    fontSize: IS_TV ? 22 : 15,
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
  },
  chipWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: IS_TV ? 14 : 8,
  },
  optionsLoader: {
    marginTop: 28,
    alignSelf: "flex-start",
  },
});

export default FiltersScreen;
