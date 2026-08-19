import { AmbientBackground } from "@/components/ambient-background";
import { CloseOverlayButton } from "@/components/close-overlay-button";
import { FocusableButton } from "@/components/FocusableButton";
import { InfoFocusRow } from "@/components/info-focus-row";
import { settingsStyles } from "@/components/settings/styles";
import {
  clearResumePosition,
  fetchVideoDetails,
  formatDuration,
  getBackdropUrl,
  getLogoUrl,
  getPersonImageUrl,
  getPosterUrl,
  hasPoster,
  isAudioItem,
  notifyResumeChange,
  setVideoFavorite,
  setVideoPlayed,
} from "@/services/jellyfinApi";
import { containerKey, dismissNextUpContainer } from "@/services/nextUp";
import { useShowInFolder } from "@/hooks/useShowInFolder";
import { PlaybackLane, predictPlaybackLane } from "@/services/localRemux";
import { JellyfinMediaStream, JellyfinVideoItem } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { formatBitrate, formatFileSize, joinMeta, streamDetailLine } from "@/utils/mediaInfo";
import { formatSeasonEpisode } from "@/utils/seasonEpisode";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Platform, ScrollView, StyleSheet, Text, TVFocusGuideView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;

/**
 * Video Info panel: everything the server knows about one item, plus its
 * actions — Play/Favorite CTAs and the watched / show-in-folder / remove-
 * progress links. Opened by long press on any card; tap-to-play stays the
 * primary gesture. Presented as a form sheet on iPhone and as a floating card
 * over the item's backdrop on tvOS (root push; stack rule: no custom Menu
 * handlers, the CTAs hold focus so Menu pops natively).
 */
export default function VideoInfoScreen() {
  // inFolderId: the folder screen the press came from. fromResume: pressed on a Continue card.
  const params = useLocalSearchParams<{ videoId: string; name?: string; inFolderId?: string; fromResume?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const openItem = useOpenShelfItem();
  // Portrait sheet width can't fit two labeled CTAs side by side without wrapping.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const stackCtas = !IS_TV && windowHeight >= windowWidth;
  // Measured hero width → explicit clamped height. aspectRatio + maxHeight must never
  // meet on the hero: when Yoga clamps the height it re-derives the WIDTH from the
  // ratio, and the artwork covers only part of the header.
  const [heroWidth, setHeroWidth] = useState(0);
  const heroHeightFor = (width: number, hasArt: boolean) => {
    // Landscape phone: width-derived caps exceed the ~440pt window height, so the
    // hero also clamps to a share of it (no-op in portrait).
    const phoneCap = windowHeight * 0.42;
    if (hasArt) return Math.min((width * 9) / 16, IS_TV ? 460 : Math.min(320, phoneCap));
    // Artless hero: just enough for the inset face plus a tight gap to the title below.
    return IS_TV ? 388 : Math.min(Math.min(width * 0.8, 380) - 88, phoneCap);
  };

  const [details, setDetails] = useState<JellyfinVideoItem | null>(null);
  const [failed, setFailed] = useState(false);
  const [lane, setLane] = useState<PlaybackLane | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isPlayed, setIsPlayed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const showInFolder = useShowInFolder();

  // Fresh fetch on purpose: list-query UserData can arrive empty or stale
  // depending on the query shape that produced the card (see lessons-learned).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const fetched = await fetchVideoDetails(params.videoId);
        if (cancelled) return;
        if (!fetched) throw new Error("Item details unavailable");
        setDetails(fetched);
        setIsFavorite(!!fetched.UserData?.IsFavorite);
        setIsPlayed(!!fetched.UserData?.Played);
        const predicted = await predictPlaybackLane(fetched);
        if (!cancelled) setLane(predicted);
      } catch (error) {
        logger.warn("Video info failed to load", error, { service: "VideoInfo", videoId: params.videoId });
        if (!cancelled) setFailed(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.videoId, attempt]);

  // Phone: REPLACE this sheet with the player — pushing on top of a presented
  // modal gets a zero-frame modal screen and the AVKit presentation crashes
  // (see useOpenShelfItem). TV is a regular push, so stacking is fine and back
  // returns to this card.
  const handlePlay = useCallback(() => {
    if (details) openItem(details, { replace: !IS_TV });
  }, [details, openItem]);

  const toggleFavorite = useCallback(async () => {
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      await setVideoFavorite(params.videoId, next);
    } catch (error) {
      setIsFavorite(!next);
      logger.warn("Failed to toggle favorite", error, { service: "VideoInfo", videoId: params.videoId });
    }
  }, [isFavorite, params.videoId]);

  const toggleWatched = useCallback(async () => {
    const next = !isPlayed;
    setIsPlayed(next);
    try {
      await setVideoPlayed(params.videoId, next);
    } catch (error) {
      setIsPlayed(!next);
      logger.warn("Failed to toggle played", error, { service: "VideoInfo", videoId: params.videoId });
    }
  }, [isPlayed, params.videoId]);

  const handleShowInFolder = useCallback(() => {
    if (!details) return;
    // Phone: the panel is a presented modal, and pushing over one breaks (see
    // handlePlay) — dismiss it first; the hook's ancestor fetch runs before any
    // push. TV pushes on top and Menu walks back through the levels.
    if (!IS_TV) router.back();
    void showInFolder(details);
  }, [details, router, showInFolder]);

  const handleRemoveProgress = useCallback(async () => {
    if (!details) return;
    try {
      if ((details.UserData?.PlaybackPositionTicks ?? 0) > 0) {
        await clearResumePosition(details.Id);
      } else {
        // A next-up card: nothing started server-side, so removal is the session-local
        // container dismissal, announced so the row rebuilds without it.
        const container = containerKey(details);
        if (container) {
          dismissNextUpContainer(container);
          notifyResumeChange();
        }
      }
    } catch (error) {
      logger.warn("Failed to remove progress", error, { service: "VideoInfo", videoId: details.Id });
    }
    router.back();
  }, [details, router]);

  const title = details?.Name ?? params.name ?? "";
  const audio = details ? isAudioItem(details) : false;
  const contextLine = details ? (audio ? joinMeta([details.Artists?.join(", "), details.Album]) : joinMeta([details.SeriesName, formatSeasonEpisode(details)])) : "";
  const year = details?.ProductionYear ? String(details.ProductionYear) : "";
  const genresLine = details?.Genres?.length ? details.Genres.join(" · ") : "";
  const metaLine = details
    ? joinMeta([
        genresLine,
        year,
        details.RunTimeTicks ? formatDuration(details.RunTimeTicks) : "",
        details.OfficialRating,
        details.CommunityRating ? `★ ${details.CommunityRating.toFixed(1)}` : "",
        details.CriticRating ? `${Math.round(details.CriticRating)}% critics` : "",
      ])
    : "";
  const tagline = details?.Taglines?.[0];
  const studiosLine = details?.Studios?.length ? details.Studios.map((studio) => studio.Name).join(" · ") : "";
  const people = details?.People?.slice(0, IS_TV ? 6 : 15) ?? [];
  const source = details?.MediaSources?.[0];
  const fileName = details?.Path?.split("/").pop() ?? "";
  const fileLine = joinMeta([source?.Container?.toUpperCase(), formatFileSize(source?.Size), formatBitrate(source?.Bitrate)]);

  const streamsOf = (type: string): JellyfinMediaStream[] => details?.MediaStreams?.filter((stream) => stream.Type === type) ?? [];
  // The axis that matters is server involvement, so the two engine lanes carry
  // the same "no server work" tail and the ecosystem's own term for untouched
  // streams (Direct Play).
  const laneLabel = lane === null ? "" : lane === "server" ? "Transcoded by the server" : lane === "deviceTranscode" ? "Re-encoded on this device · no server work" : "Direct Play · no server work";
  const laneColor = lane === "server" ? "#98989D" : lane === "deviceTranscode" ? "#FFC312" : "#34C759";

  const logoUri = details?.ImageTags?.Logo ? getLogoUrl(details.Id) : "";
  const posterUri = details && hasPoster(details) ? getPosterUrl(details.Id, IS_TV ? 600 : 300) : "";
  // Hero: real backdrop preferred, sharp Primary cover-cropped otherwise.
  const heroUri = details?.BackdropImageTags?.length ? getBackdropUrl(details.Id) : posterUri;

  const renderStreamSection = (heading: string, streams: JellyfinMediaStream[]) => {
    if (streams.length === 0) return null;
    return (
      <>
        <Text style={styles.sectionHeading}>{heading}</Text>
        {streams.map((stream, index) => (
          <InfoFocusRow key={`${heading}-${stream.Index ?? index}`} style={styles.streamRow}>
            <Text style={styles.streamTitle}>{stream.DisplayTitle || stream.Title || stream.Codec?.toUpperCase() || "Unknown"}</Text>
            {!!streamDetailLine(stream) && <Text style={styles.streamDetail}>{streamDetailLine(stream)}</Text>}
          </InfoFocusRow>
        ))}
      </>
    );
  };

  // CTA row through File — one fragment, hosted by both platform layouts.
  const sections = details ? (
    <>
      <View style={[styles.ctaRow, stackCtas && styles.ctaColumn]}>
        <FocusableButton
          title={details.UserData?.PlaybackPositionTicks ? "Resume" : "Play"}
          variant="primary"
          hasTVPreferredFocus
          icon={<Ionicons name="play" size={IS_TV ? 26 : 18} color="#000000" />}
          onPress={handlePlay}
        />
        {!!details.ParentId && params.inFolderId !== details.ParentId && (
          <FocusableButton title="Show in Folder" variant="secondary" icon={<Ionicons name="folder-outline" size={IS_TV ? 26 : 18} color="#FFC312" />} onPress={handleShowInFolder} />
        )}
      </View>

      {/* Alternate actions as a link row under the CTAs (FocusableButton's link variant). */}
      {/* Icon + single word; the icon's fill carries the toggle state. */}
      <View style={styles.linkRow}>
        <FocusableButton
          title="Favorite"
          variant="link"
          icon={<Ionicons name={isFavorite ? "heart" : "heart-outline"} size={IS_TV ? 22 : 16} color="#FFC312" />}
          accessibilityLabel={isFavorite ? "Remove favorite" : "Add to favorites"}
          onPress={toggleFavorite}
        />
        <FocusableButton
          title="Watched"
          variant="link"
          icon={<Ionicons name={isPlayed ? "checkmark-circle" : "checkmark-circle-outline"} size={IS_TV ? 22 : 16} color="#FFC312" />}
          accessibilityLabel={isPlayed ? "Mark as unwatched" : "Mark as watched"}
          onPress={toggleWatched}
        />
        {!!params.fromResume && (
          <FocusableButton
            title="Clear Progress"
            variant="link"
            icon={<Ionicons name="close-circle-outline" size={IS_TV ? 22 : 16} color="#FF3B30" />}
            textStyle={styles.removeProgressText}
            onPress={handleRemoveProgress}
          />
        )}
      </View>

      {!!tagline && <Text style={styles.tagline}>{tagline}</Text>}
      {!!details.Overview && (
        <InfoFocusRow style={styles.overviewBlock}>
          <Text style={styles.overview}>{details.Overview}</Text>
        </InfoFocusRow>
      )}
      {!!studiosLine && <Text style={styles.studios}>{studiosLine}</Text>}

      {people.length > 0 && (
        <>
          <Text style={styles.sectionHeading}>Cast & Crew</Text>
          <ScrollView horizontal={!IS_TV} scrollEnabled={!IS_TV} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.castRow}>
            {people.map((person) => (
              <View key={person.Id} style={styles.castEntry}>
                {person.PrimaryImageTag ? (
                  <Image source={{ uri: getPersonImageUrl(person.Id) }} style={styles.castPhoto} contentFit="cover" transition={200} accessible accessibilityLabel={person.Name} />
                ) : (
                  <View style={[styles.castPhoto, styles.castPhotoEmpty]}>
                    <Ionicons name="person" size={IS_TV ? 40 : 26} color="#98989D" />
                  </View>
                )}
                <Text style={styles.castName} numberOfLines={1}>
                  {person.Name}
                </Text>
                {!!(person.Role || person.Type) && (
                  <Text style={styles.castRole} numberOfLines={1}>
                    {person.Role || person.Type}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>
        </>
      )}

      {renderStreamSection("Video", streamsOf("Video"))}
      {renderStreamSection("Audio", streamsOf("Audio"))}
      {renderStreamSection("Subtitles", streamsOf("Subtitle"))}

      {!!(fileName || fileLine) && (
        <>
          <Text style={styles.sectionHeading}>File</Text>
          <InfoFocusRow style={styles.streamRow}>
            {!!fileName && <Text style={styles.streamTitle}>{fileName}</Text>}
            {!!fileLine && <Text style={styles.streamDetail}>{fileLine}</Text>}
          </InfoFocusRow>
        </>
      )}
    </>
  ) : null;

  const body = failed ? (
    <View style={styles.stateWrap}>
      <Text style={styles.errorText}>{`Couldn't load details for ${title || "this item"}.`}</Text>
      <FocusableButton
        title="Retry"
        variant="retry"
        hasTVPreferredFocus
        onPress={() => {
          setFailed(false);
          setAttempt((n) => n + 1);
        }}
      />
    </View>
  ) : !details ? (
    <View style={styles.stateWrap}>
      <ActivityIndicator size="large" color="#FFC312" />
    </View>
  ) : (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: IS_TV ? 48 : insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
      {/* Full-bleed artwork heading on both platforms; the scrim fades it into
          the panel. Artless items keep the same hero with the brand face
          (layer-front) centered in it — the cards' no-poster mark. */}
      <View style={[styles.hero, heroWidth > 0 && { height: heroHeightFor(heroWidth, !!heroUri) }]} onLayout={(event) => setHeroWidth(event.nativeEvent.layout.width)}>
        {heroUri ? (
          // Center-crop only: any non-center contentPosition mis-offsets expo-image's
          // container-filling view by the content size and blanks the hero on large crops.
          <Image source={{ uri: heroUri }} style={StyleSheet.absoluteFill} contentFit="cover" transition={250} cachePolicy="memory-disk" accessible accessibilityLabel={`${title} artwork`} />
        ) : (
          <Image source={require("@/assets/brand/layer-front.png")} style={styles.heroFace} contentFit="contain" transition={0} accessible accessibilityLabel={`${title} artwork`} />
        )}
        {/* Bottom stop matches the surface under the hero: the section bg on TV, the sheet on phone. */}
        <LinearGradient colors={["rgba(20, 20, 20, 0)", "rgba(20, 20, 20, 0.45)", IS_TV ? "#2C2C2E" : "#141414"]} locations={[0.35, 0.72, 1]} style={StyleSheet.absoluteFill} />
        {/* The section's top lip, re-painted above the opaque artwork (settings rowShadowTop
            move). Overlay is tvOS-safe here: the hero holds no focusables. */}
        {IS_TV && <View pointerEvents="none" style={[StyleSheet.absoluteFill, settingsStyles.rowShadowTop]} />}
      </View>
      {/* Title sits below the hero on every item — never over the artwork. */}
      <View style={[styles.heroTitleWrap, styles.heroTitleBelow, !IS_TV && { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }]}>
        {IS_TV && logoUri ? (
          <Image source={{ uri: logoUri }} style={styles.heroLogo} contentFit="contain" contentPosition="left bottom" transition={200} accessible accessibilityLabel={title} />
        ) : (
          <Text style={styles.heroTitle} numberOfLines={2}>
            {title}
          </Text>
        )}
        {!!contextLine && <Text style={styles.heroContext}>{contextLine}</Text>}
      </View>
      <View style={IS_TV ? styles.tvPad : { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }}>
        {!!metaLine && <Text style={[styles.metaLine, styles.metaBlock]}>{metaLine}</Text>}
        {!!laneLabel && (
          <View style={[styles.laneRow, styles.laneBlock]}>
            <View style={[styles.laneDot, { backgroundColor: laneColor }]} />
            <Text style={styles.laneText}>{laneLabel}</Text>
          </View>
        )}
        {sections}
      </View>
    </ScrollView>
  );

  if (!IS_TV) {
    return (
      <View style={styles.sheetRoot}>
        {body}
        <CloseOverlayButton onPress={() => router.back()} style={{ position: "absolute", top: 12, right: 12 + insets.right }} accessibilityHint="Closes the video info panel" />
      </View>
    );
  }

  return (
    <TVFocusGuideView style={styles.flex} trapFocusUp>
      <View style={styles.tvRoot}>
        {/* The app's own ambient canvas, not the item's artwork — the art belongs to the card's hero. */}
        <AmbientBackground />
        {/* The card IS a sunken section: radius, background and inset shadow all inherited. */}
        <View style={[settingsStyles.section, styles.card]}>{body}</View>
      </View>
    </TVFocusGuideView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  // iPhone page sheet: the sheet itself is the card, content fills it edge to edge.
  sheetRoot: {
    flex: 1,
    backgroundColor: "#141414",
  },
  tvRoot: {
    flex: 1,
    backgroundColor: "#0D0D0F",
    alignItems: "center",
  },
  // Sizing overrides on top of settingsStyles.section — look and radius come from there.
  card: {
    flex: 1,
    width: 1100,
    maxWidth: "86%",
    marginVertical: 56,
  },
  stateWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: IS_TV ? 28 : 18,
    padding: 32,
  },
  errorText: {
    fontSize: IS_TV ? 26 : 16,
    color: "#98989D",
    textAlign: "center",
  },
  scroll: {
    flex: 1,
  },
  // Full-bleed artwork heading; the title sits in its bottom-left corner.
  // NO aspectRatio here, ever: Yoga recomputes the WIDTH from it (even against
  // width 100% or an explicit height) and the artwork stops covering the header.
  // Height only — the measured inline value refines this default (see heroWidth).
  hero: {
    width: "100%",
    height: IS_TV ? 460 : 240,
    justifyContent: "flex-end",
    backgroundColor: "#2C2C2E",
  },
  // Transparent brand face, contained and inset so it reads as a small centered
  // mark over the hero's dark fill rather than full-bleed art.
  heroFace: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    margin: IS_TV ? 80 : 44,
    // Shallower top/bottom insets keep the face high and the title close below.
    marginTop: IS_TV ? 40 : 12,
    marginBottom: IS_TV ? 48 : 20,
  },
  heroTitleWrap: {
    paddingBottom: IS_TV ? 28 : 16,
    paddingHorizontal: IS_TV ? 48 : 0,
  },
  heroTitleBelow: {
    marginTop: IS_TV ? 5 : 16,
  },
  heroTitle: {
    fontSize: IS_TV ? 44 : 30,
    fontWeight: "700",
    color: "#FFFFFF",
  },
  heroContext: {
    fontSize: IS_TV ? 24 : 15,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.9)",
    marginTop: IS_TV ? 8 : 4,
  },
  heroLogo: {
    width: "60%",
    height: 110,
  },
  // Interior padding for everything below the hero on TV; phone uses inset-aware inline padding.
  tvPad: {
    paddingHorizontal: 48,
  },
  metaBlock: {
    marginTop: IS_TV ? 28 : 14,
  },
  laneBlock: {
    marginTop: 8,
  },
  metaLine: {
    fontSize: IS_TV ? 20 : 13,
    color: "#98989D",
  },
  laneRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 10 : 6,
  },
  laneDot: {
    width: IS_TV ? 10 : 7,
    height: IS_TV ? 10 : 7,
    borderRadius: 999,
  },
  laneText: {
    fontSize: IS_TV ? 18 : 12,
    color: "#98989D",
  },
  // Content-sized buttons (FocusableButton's own min width), centered in the panel.
  ctaRow: {
    flexDirection: "row",
    alignSelf: "center",
    gap: IS_TV ? 28 : 16,
    marginTop: IS_TV ? 40 : 30,
  },
  // Portrait stack: content-sized buttons, centered.
  ctaColumn: {
    flexDirection: "column",
    alignItems: "center",
    gap: 22,
  },
  linkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignSelf: "center",
    justifyContent: "center",
    gap: IS_TV ? 20 : 10,
    marginTop: IS_TV ? 24 : 20,
  },
  // Destructive text color on the link shape — the pill-less row keeps its geometry.
  removeProgressText: {
    color: "#FF3B30",
  },
  tagline: {
    fontSize: IS_TV ? 22 : 14,
    fontStyle: "italic",
    color: "#98989D",
    marginTop: IS_TV ? 28 : 18,
  },
  overviewBlock: {
    marginTop: IS_TV ? 16 : 12,
  },
  overview: {
    fontSize: IS_TV ? 22 : 15,
    lineHeight: IS_TV ? 32 : 22,
    color: "rgba(255, 255, 255, 0.94)",
  },
  studios: {
    fontSize: IS_TV ? 18 : 12,
    color: "#98989D",
    marginTop: IS_TV ? 8 : 5,
  },
  sectionHeading: {
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "600",
    color: "#8E8E93",
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginTop: IS_TV ? 36 : 24,
    marginBottom: IS_TV ? 14 : 8,
  },
  castRow: {
    flexDirection: "row",
    gap: IS_TV ? 24 : 14,
  },
  castEntry: {
    width: IS_TV ? 120 : 76,
    alignItems: "center",
    gap: IS_TV ? 8 : 4,
  },
  castPhoto: {
    width: IS_TV ? 100 : 64,
    height: IS_TV ? 100 : 64,
    borderRadius: 999,
    backgroundColor: "#2C2C2E",
  },
  castPhotoEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  castName: {
    fontSize: IS_TV ? 17 : 12,
    fontWeight: "600",
    color: "#FFFFFF",
    textAlign: "center",
  },
  castRole: {
    fontSize: IS_TV ? 15 : 11,
    color: "#98989D",
    textAlign: "center",
  },
  streamRow: {
    marginBottom: IS_TV ? 14 : 10,
  },
  streamTitle: {
    fontSize: IS_TV ? 21 : 14,
    fontWeight: "600",
    color: "#FFFFFF",
  },
  streamDetail: {
    fontSize: IS_TV ? 18 : 12,
    color: "#98989D",
    marginTop: 2,
  },
});
