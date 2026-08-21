import { AmbientBackground } from "@/components/ambient-background";
import { CloseOverlayButton } from "@/components/close-overlay-button";
import { FocusableButton } from "@/components/FocusableButton";
import { InfoFocusRow } from "@/components/info-focus-row";
import { ProgressButton } from "@/components/progress-button";
import { settingsStyles } from "@/components/settings/styles";
import {
  clearResumePosition,
  fetchItemDetails,
  fetchItemFolderPath,
  formatDuration,
  getBackdropUrl,
  getLogoUrl,
  getPersonImageUrl,
  getPosterUrl,
  hasPoster,
  isAudioItem,
  isFolder,
  isPhoto,
  notifyResumeChange,
  setVideoFavorite,
  setVideoPlayed,
} from "@/services/jellyfinApi";
import { COLORS } from "@/constants/colors";
import { containerKey, dismissNextUpContainer } from "@/services/nextUp";
import { useShowInFolder } from "@/hooks/useShowInFolder";
import { PlaybackLane, predictPlaybackLane } from "@/services/localRemux";
import { JellyfinItem, JellyfinMediaStream } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { buildDetailRows, formatBitrate, formatFileSize, formatIndexLine, formatPixelSize, joinMeta, streamDetailLine } from "@/utils/mediaInfo";
import { cardResumeProgress } from "@/utils/resumeProgress";
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
  // Source aspect of the loaded artwork, so a hero taller than its 16:9 box can be
  // anchored at the top rather than centre-cropped.
  const [heroAspect, setHeroAspect] = useState<number | null>(null);
  const heroHeightFor = (width: number, hasArt: boolean) => {
    // Landscape phone: width-derived caps exceed the ~440pt window height, so the
    // hero also clamps to a share of it (no-op in portrait).
    const phoneCap = windowHeight * 0.42;
    if (hasArt) return Math.min((width * 9) / 16, IS_TV ? 460 : Math.min(320, phoneCap));
    // Artless hero: just enough for the inset face plus a tight gap to the title below.
    return IS_TV ? 388 : Math.min(Math.min(width * 0.8, 380) - 88, phoneCap);
  };

  const [details, setDetails] = useState<JellyfinItem | null>(null);
  const [failed, setFailed] = useState(false);
  const [plan, setPlan] = useState<{ lane: PlaybackLane; smallFeedFirst: boolean } | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isPlayed, setIsPlayed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // The folder the item actually lives in. A library root lists items whose ParentId is the
  // PHYSICAL folder, never the CollectionFolder id the screen holds, so ParentId alone can't
  // tell "already here" from "lives elsewhere".
  const [folderLeafId, setFolderLeafId] = useState<string | null>(null);
  const showInFolder = useShowInFolder();

  // Fresh fetch on purpose: list-query UserData can arrive empty or stale
  // depending on the query shape that produced the card (see lessons-learned).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Resolved alongside the details so the CTA row paints once, with "Show in Folder"
      // already decided. [] on failure, which leaves the link in place.
      const pathPromise = params.inFolderId ? fetchItemFolderPath(params.videoId).catch(() => []) : null;
      let fetched: JellyfinItem | null = null;
      try {
        fetched = await fetchItemDetails(params.videoId);
        if (cancelled) return;
        if (!fetched) throw new Error("Item details unavailable");
        const path = pathPromise ? await pathPromise : [];
        if (cancelled) return;
        setFolderLeafId(path.length ? path[path.length - 1].id : null);
        setDetails(fetched);
        setIsFavorite(!!fetched.UserData?.IsFavorite);
        setIsPlayed(!!fetched.UserData?.Played);
      } catch (error) {
        logger.warn("Video info failed to load", error, { service: "VideoInfo", videoId: params.videoId });
        if (!cancelled) setFailed(true);
        return;
      }
      // No streams, no lane. canRemuxLocally declines anything without them, so
      // predicting would stamp "Transcoded by the server" on a photo, a series
      // folder, or an item whose sources simply failed to load — three things
      // that are not a transcode.
      if (!fetched.MediaStreams?.length) return;
      // Separate from the load: the lane is one line of the panel, so a failed
      // prediction leaves that line off rather than blanking everything above it.
      try {
        const predicted = await predictPlaybackLane(fetched);
        if (!cancelled) setPlan(predicted);
      } catch (error) {
        logger.warn("Playback lane prediction failed", error, { service: "VideoInfo", videoId: params.videoId });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.videoId, params.inFolderId, attempt]);

  // Phone: REPLACE this sheet with the player — pushing on top of a presented
  // modal gets a zero-frame modal screen and the AVKit presentation crashes
  // (see useOpenShelfItem). TV is a regular push, so stacking is fine and back
  // returns to this card.
  const handlePlay = useCallback(() => {
    if (!details) return;
    // A photo opens the viewer, not the player. The folder it lives in is the
    // set the viewer steps through: the folder the press came from when there
    // is one, its album otherwise.
    if (isPhoto(details)) {
      const folderId = params.inFolderId ?? details.ParentId;
      if (!folderId) return;
      if (!IS_TV) router.back();
      router.push({ pathname: "/photo-viewer", params: { folderId, photoId: details.Id } });
      return;
    }
    openItem(details, { replace: !IS_TV });
  }, [details, openItem, params.inFolderId, router]);

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
    // Dismiss the panel first, both platforms. Phone: pushing over a presented modal
    // breaks (see handlePlay). TV: with this root screen focused, a "/[folderId]" push
    // diverges at the ROOT stack and pushes a duplicate (tabs) instance, so Menu can't
    // walk the folder levels. The hook's ancestor fetch runs before any push.
    router.back();
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
  const photo = details ? isPhoto(details) : false;
  // A photo's album is the folder holding it, which is the same "where does this
  // sit" line the artist/album pair gives an audio item.
  //
  // The index tail is the same string on both branches, and the same call the cards
  // badge from: an episode's "S01E05", a song's "Disc 2 · Track 5".
  const indexLine = details ? formatIndexLine(details) : "";
  const contextLine = details ? (photo ? (details.Album ?? "") : audio ? joinMeta([details.Artists?.join(", "), details.Album, indexLine]) : joinMeta([details.SeriesName, indexLine])) : "";
  const year = details?.ProductionYear ? String(details.ProductionYear) : "";
  const genresLine = details?.Genres?.length ? details.Genres.join(" · ") : "";
  // A photo has none of the fields the meta line is built from. Its pixel count
  // is the one headline fact it does have, so it takes the runtime's place; the
  // dates and the rest live in the Details table.
  const metaLine = !details
    ? ""
    : photo
      ? formatPixelSize(details.Width, details.Height)
      : joinMeta([
          genresLine,
          year,
          details.RunTimeTicks ? formatDuration(details.RunTimeTicks) : "",
          details.OfficialRating,
          details.CommunityRating ? `★ ${details.CommunityRating.toFixed(1)}` : "",
          details.CriticRating ? `${Math.round(details.CriticRating)}% critics` : "",
        ]);
  const tagline = details?.Taglines?.[0];
  const studiosLine = details?.Studios?.length ? details.Studios.map((studio) => studio.Name).join(" · ") : "";
  const people = details?.People?.slice(0, IS_TV ? 6 : 15) ?? [];
  const source = details?.MediaSources?.[0];
  const fileName = details?.Path?.split("/").pop() ?? "";
  // Kinds with no media source (photos) carry the container at the top level, or
  // name it in the path.
  const container = (source?.Container || details?.Container)?.toUpperCase() || (fileName.includes(".") ? (fileName.split(".").pop()?.toUpperCase() ?? "") : "");
  const fileLine = joinMeta([container, formatFileSize(source?.Size), formatBitrate(source?.Bitrate)]);

  const streamsOf = (type: string): JellyfinMediaStream[] => details?.MediaStreams?.filter((stream) => stream.Type === type) ?? [];
  // The complete readout: whatever the server holds that the sections above do
  // not already show. A photo and a series folder have no streams, so this is
  // the only place their metadata appears.
  const detailRows = details ? buildDetailRows(details, { dimensionsShownElsewhere: photo || streamsOf("Video").length > 0 }) : [];
  // The axis that matters is server involvement, so the two engine lanes carry
  // the same "no server work" tail and the ecosystem's own term for untouched
  // streams (Direct Play). On a link measured below the file, the session opens
  // on the smaller server-fed rung — "no server work" would be false there, so
  // the tail says what actually happens.
  const lane = plan?.lane ?? null;
  const engineTail = plan?.smallFeedFirst ? "starts on a smaller server feed for your connection" : "no server work";
  const laneLabel = lane === null ? "" : lane === "server" ? "Transcoded by the server" : lane === "deviceTranscode" ? `Re-encoded on this device · ${engineTail}` : `Direct Play · ${engineTail}`;
  const laneColor = lane === "server" ? COLORS.TEXT_SECONDARY : lane === "deviceTranscode" ? COLORS.ACCENT : COLORS.SUCCESS;

  const logoUri = details?.ImageTags?.Logo ? getLogoUrl(details.Id) : "";
  const posterUri = details && hasPoster(details) ? getPosterUrl(details.Id, IS_TV ? 600 : 300) : "";
  // Hero: real backdrop preferred, sharp Primary cover-cropped otherwise.
  const heroUri = details?.BackdropImageTags?.length ? getBackdropUrl(details.Id) : posterUri;

  const handleHeroLoad = (event: { source?: { width: number; height: number } | null }) => {
    const source = event.source;
    if (!source?.width || !source.height) return;
    setHeroAspect(source.width / source.height);
  };

  // Taller than the box: full width at the source's own ratio, pinned to the top, the foot
  // clipped by the hero. Wider (or not yet measured): the plain centred cover fill.
  const heroHeight = heroWidth > 0 ? heroHeightFor(heroWidth, !!heroUri) : 0;
  const heroCropStyle =
    heroWidth > 0 && heroHeight > 0 && heroAspect != null && heroAspect < heroWidth / heroHeight
      ? { position: "absolute" as const, top: 0, left: 0, width: heroWidth, height: heroWidth / heroAspect }
      : StyleSheet.absoluteFill;

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
        <ProgressButton
          title={photo ? "View" : details.UserData?.PlaybackPositionTicks ? "Resume" : "Play"}
          variant="primary"
          hasTVPreferredFocus
          icon={<Ionicons name={photo ? "expand" : "play"} size={IS_TV ? 26 : 18} color={COLORS.ON_ACCENT} />}
          onPress={handlePlay}
          progress={cardResumeProgress(details)}
        />
        {!!details.ParentId && params.inFolderId !== details.ParentId && params.inFolderId !== folderLeafId && (
          <FocusableButton title="Show in Folder" variant="secondary" icon={<Ionicons name="folder-outline" size={IS_TV ? 26 : 18} color={COLORS.ACCENT} />} onPress={handleShowInFolder} />
        )}
      </View>

      {/* Alternate actions as a link row under the CTAs (FocusableButton's link variant). */}
      {/* Icon + single word; the icon's fill carries the toggle state. */}
      <View style={styles.linkRow}>
        <FocusableButton
          title="Favorite"
          variant="link"
          icon={<Ionicons name={isFavorite ? "heart" : "heart-outline"} size={IS_TV ? 22 : 16} color={COLORS.ACCENT} />}
          accessibilityLabel={isFavorite ? "Remove favorite" : "Add to favorites"}
          onPress={toggleFavorite}
        />
        <FocusableButton
          title="Watched"
          variant="link"
          icon={<Ionicons name={isPlayed ? "checkmark-circle" : "checkmark-circle-outline"} size={IS_TV ? 22 : 16} color={COLORS.ACCENT} />}
          accessibilityLabel={isPlayed ? "Mark as unwatched" : "Mark as watched"}
          onPress={toggleWatched}
        />
        {/* Any item with progress can clear it; fromResume also covers next-up cards
            (zero progress, where removal is the session-local container dismissal). */}
        {(!!params.fromResume || (details.UserData?.PlaybackPositionTicks ?? 0) > 0) && (
          <FocusableButton
            title="Clear Progress"
            variant="link"
            icon={<Ionicons name="close-circle-outline" size={IS_TV ? 22 : 16} color={COLORS.DESTRUCTIVE} />}
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
                    <Ionicons name="person" size={IS_TV ? 40 : 26} color={COLORS.TEXT_SECONDARY} />
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

      {detailRows.length > 0 && (
        <>
          <Text style={styles.sectionHeading}>Details</Text>
          {/* One focus stop for the whole table: a stream row per stream is a
              handful, but a landing per fact would be fifteen presses to cross. */}
          <InfoFocusRow style={styles.detailTable}>
            {detailRows.map((row) => (
              <View key={row.label} style={styles.detailRow}>
                <Text style={styles.detailLabel} numberOfLines={1}>
                  {row.label}
                </Text>
                <Text style={styles.detailValue}>{row.value}</Text>
              </View>
            ))}
          </InfoFocusRow>
        </>
      )}

      {!!(fileName || fileLine) && (
        <>
          {/* Series, seasons and albums are directories on disk, not files. */}
          <Text style={styles.sectionHeading}>{isFolder(details) ? "Folder" : "File"}</Text>
          <InfoFocusRow style={styles.streamRow}>
            {!!fileName && <Text style={styles.streamTitle}>{fileName}</Text>}
            {!!fileLine && <Text style={styles.streamDetail}>{fileLine}</Text>}
            {!!details.Path && <Text style={styles.filePath}>{details.Path}</Text>}
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
      <ActivityIndicator size="large" color={COLORS.ACCENT} />
    </View>
  ) : (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: IS_TV ? 48 : insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
      {/* Full-bleed artwork heading on both platforms; the scrim fades it into
          the panel. Artless items keep the same hero with the brand face
          (layer-front) centered in it — the cards' no-poster mark. */}
      <View style={[styles.hero, heroHeight > 0 && { height: heroHeight }]} onLayout={(event) => setHeroWidth(event.nativeEvent.layout.width)}>
        {heroUri ? (
          // Top-anchored crop. contentPosition is not the way: expo-image offsets the image
          // VIEW, not its content, so a cover fit slides the view down and bares the hero.
          // A source taller than the box gets an explicit oversize height clipped at the foot;
          // a wider one keeps the centred cover fill.
          <Image
            key={heroUri}
            source={{ uri: heroUri }}
            style={heroCropStyle}
            contentFit="cover"
            transition={250}
            cachePolicy="memory-disk"
            onLoad={handleHeroLoad}
            accessible
            accessibilityLabel={`${title} artwork`}
          />
        ) : (
          <Image source={require("@/assets/brand/layer-front.png")} style={styles.heroFace} contentFit="contain" transition={0} accessible accessibilityLabel={`${title} artwork`} />
        )}
        {/* Bottom stop matches the surface under the hero: the section bg on TV, the sheet on phone. */}
        <LinearGradient colors={["rgba(20, 20, 20, 0)", "rgba(20, 20, 20, 0.45)", IS_TV ? COLORS.SURFACE : COLORS.BACKGROUND]} locations={[0.35, 0.72, 1]} style={StyleSheet.absoluteFill} />
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
    backgroundColor: COLORS.BACKGROUND,
  },
  tvRoot: {
    flex: 1,
    backgroundColor: COLORS.BACKGROUND_DEEP,
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
    color: COLORS.TEXT_SECONDARY,
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
    backgroundColor: COLORS.SURFACE,
    // A top-anchored crop overhangs the foot of the hero (see heroCropStyle).
    overflow: "hidden",
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
    color: COLORS.TEXT_PRIMARY,
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
    color: COLORS.TEXT_SECONDARY,
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
    color: COLORS.TEXT_SECONDARY,
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
    color: COLORS.DESTRUCTIVE,
  },
  tagline: {
    fontSize: IS_TV ? 22 : 14,
    fontStyle: "italic",
    color: COLORS.TEXT_SECONDARY,
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
    color: COLORS.TEXT_SECONDARY,
    marginTop: IS_TV ? 8 : 5,
  },
  sectionHeading: {
    fontSize: IS_TV ? 22 : 13,
    fontWeight: "600",
    color: COLORS.TEXT_TERTIARY,
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
    backgroundColor: COLORS.SURFACE,
  },
  castPhotoEmpty: {
    alignItems: "center",
    justifyContent: "center",
  },
  castName: {
    fontSize: IS_TV ? 17 : 12,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
    textAlign: "center",
  },
  castRole: {
    fontSize: IS_TV ? 15 : 11,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
  streamRow: {
    marginBottom: IS_TV ? 14 : 10,
  },
  streamTitle: {
    fontSize: IS_TV ? 21 : 14,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
  streamDetail: {
    fontSize: IS_TV ? 18 : 12,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 2,
  },
  // The path is the longest thing on the panel and the least urgent — it wraps
  // rather than truncating, so a file can always be located from what is shown.
  filePath: {
    fontSize: IS_TV ? 16 : 11,
    color: COLORS.TEXT_QUATERNARY,
    marginTop: 4,
  },
  detailTable: {
    marginBottom: IS_TV ? 8 : 4,
  },
  // Label and value on one line, label fixed so the values stack into a column.
  detailRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: IS_TV ? 16 : 10,
    marginBottom: IS_TV ? 10 : 7,
  },
  detailLabel: {
    width: IS_TV ? 190 : 116,
    fontSize: IS_TV ? 18 : 12,
    color: COLORS.TEXT_TERTIARY,
  },
  detailValue: {
    flex: 1,
    fontSize: IS_TV ? 21 : 14,
    color: COLORS.TEXT_PRIMARY,
  },
});
