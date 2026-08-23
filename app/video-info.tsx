import { AmbientBackground } from "@/components/ambient-background";
import { CloseOverlayButton } from "@/components/close-overlay-button";
import { FocusableButton } from "@/components/FocusableButton";
import { InfoActionRow } from "@/components/info-action-row";
import { InfoFocusRow } from "@/components/info-focus-row";
import { ProgressButton } from "@/components/progress-button";
import { settingsStyles } from "@/components/settings/styles";
import {
  clearResumePosition,
  fetchFolderMediaKinds,
  FolderMediaKinds,
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
import { useLoadingActions } from "@/contexts/LoadingContext";
import { containerKey, dismissNextUpContainer } from "@/services/nextUp";
import { FolderPlayKind, useFolderPlay } from "@/hooks/useFolderPlay";
import { useFolderDownload } from "@/hooks/useFolderDownload";
import { useItemDownload } from "@/hooks/useItemDownload";
import { downloadsSupported } from "@/services/downloads/paths";
import { useShowInFolder } from "@/hooks/useShowInFolder";
import { PlaybackLane, predictPlaybackLane } from "@/services/localRemux";
import { JellyfinItem, JellyfinMediaStream } from "@/types/jellyfin";
import { logger } from "@/utils/logger";
import { buildDetailRows, formatBitrate, formatFileSize, formatIndexLine, formatPixelSize, joinMeta, overviewParagraphs, streamDetailLine } from "@/utils/mediaInfo";
import { cardResumeProgress } from "@/utils/resumeProgress";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { Ionicons } from "@expo/vector-icons";
import { BlurView } from "expo-blur";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TVFocusGuideView, useWindowDimensions, View } from "react-native";
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
// iPad presents the panel over the app rather than as a page sheet: UIKit hands out no control
// over what shows either side of a sheet, so the screen has to own its own backdrop.
const IS_PAD = !IS_TV && Platform.OS === "ios" && Platform.isPad;
/** Measured off the page sheet this replaces (1560px shot: 1413 wide, centred), so it keeps its frame. */
const PAD_SHEET_RATIO = 0.905;

/**
 * Video Info panel: everything the server knows about one item, plus its
 * actions — play CTAs (a container plays what it holds), show in folder, and
 * the favorite / watched / remove-progress links a leaf carries. Opened by long
 * press on any card; tap-to-play stays the primary gesture. Presented as a form sheet on iPhone and as a floating card
 * over the item's backdrop on tvOS (root push; stack rule: no custom Menu
 * handlers, the CTAs hold focus so Menu pops natively).
 */
export default function VideoInfoScreen() {
  // inFolderId: the folder screen the press came from. fromResume: pressed on a Continue card.
  const params = useLocalSearchParams<{ videoId: string; name?: string; inFolderId?: string; fromResume?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const openItem = useOpenShelfItem();
  const { showGlobalLoader } = useLoadingActions();
  // Portrait sheet width can't fit two labeled CTAs side by side without wrapping.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const stackCtas = !IS_TV && windowHeight >= windowWidth;
  // Measured hero width → explicit clamped height. aspectRatio + maxHeight must never
  // meet on the hero: when Yoga clamps the height it re-derives the WIDTH from the
  // ratio, and the artwork covers only part of the header.
  // Seeded, not zero: the hero spans the sheet on phone and the fixed card on TV and iPad, so
  // the first paint already has the final height and onLayout only refines it.
  const [heroWidth, setHeroWidth] = useState(IS_TV ? Math.min(1100, windowWidth * 0.86) : IS_PAD ? Math.round(windowWidth * PAD_SHEET_RATIO) : windowWidth);
  // Source aspect of the loaded artwork, so a taller-than-box hero anchors at the top.
  const [heroAspect, setHeroAspect] = useState<number | null>(null);
  // Seeded heroWidth paints frame one; this says the measured one has landed. A cached image
  // can fire onLoad before the first layout pass, and the fade must not start on a guess.
  const [heroMeasured, setHeroMeasured] = useState(false);
  const heroFade = useSharedValue(0);
  const reducedMotion = useReducedMotion();
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
  // Whether the lane question has been answered at all, prediction failures included, so a
  // reserved row never stays open on an item that will never fill it.
  const [laneSettled, setLaneSettled] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [isPlayed, setIsPlayed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  // Clear Progress marks the removal, it does not perform one: leaving the panel is what
  // writes. Nothing is sent while the panel is open, so disarming costs nothing.
  const [clearArmed, setClearArmed] = useState(false);
  // Undefined for containers and photos, which hides the circle rather than disabling it.
  const { state: downloadState, toggle: toggleDownload } = useItemDownload(details);
  const pendingClearRef = useRef<{ id: string; container?: string } | null>(null);
  // The folder the item actually lives in. A library root lists items whose ParentId is the
  // PHYSICAL folder, never the CollectionFolder id the screen holds, so ParentId alone can't
  // tell "already here" from "lives elsewhere".
  const [folderLeafId, setFolderLeafId] = useState<string | null>(null);
  // Which play CTAs a container gets. null until resolved, and for every non-folder item.
  const [mediaKinds, setMediaKinds] = useState<FolderMediaKinds | null>(null);
  const showInFolder = useShowInFolder();
  const downloadFolder = useFolderDownload();
  const playFolder = useFolderPlay();

  // Fresh fetch on purpose: list-query UserData can arrive empty or stale
  // depending on the query shape that produced the card (see lessons-learned).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      // Resolved alongside the details so the CTA row paints once, with "Show in Folder"
      // already decided. [] on failure, and [] for a library root, whose only ancestor is the
      // server root the app never browses — the link there could do nothing but alert.
      const pathPromise = fetchItemFolderPath(params.videoId).catch(() => []);
      let fetched: JellyfinItem | null = null;
      try {
        fetched = await fetchItemDetails(params.videoId);
        if (cancelled) return;
        if (!fetched) throw new Error("Item details unavailable");
        const path = await pathPromise;
        // Same one-paint rule: the play CTAs state what the container actually holds.
        const kinds = isFolder(fetched) ? await fetchFolderMediaKinds(fetched) : null;
        if (cancelled) return;
        setFolderLeafId(path.length ? path[path.length - 1].id : null);
        setMediaKinds(kinds);
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
      } finally {
        if (!cancelled) setLaneSettled(true);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [params.videoId, attempt]);

  // Leaving the panel performs it. Ref-only and idempotent so the play paths can commit before
  // pushing (tvOS keeps this screen mounted under the player), with unmount as the backstop for
  // every other exit. Resolves true once the resume point is gone, so a play press can wait on it.
  const commitClearProgress = useCallback(async (): Promise<boolean> => {
    const pending = pendingClearRef.current;
    if (!pending) return false;
    pendingClearRef.current = null;
    setClearArmed(false);
    if (pending.container) {
      dismissNextUpContainer(pending.container);
      notifyResumeChange();
      return true;
    }
    try {
      await clearResumePosition(pending.id);
      return true;
    } catch (error) {
      logger.warn("Failed to clear progress", error, { service: "VideoInfo", videoId: pending.id });
      return false;
    }
  }, []);

  useEffect(() => () => void commitClearProgress(), [commitClearProgress]);

  // Phone: REPLACE this sheet with the player — pushing on top of a presented
  // modal gets a zero-frame modal screen and the AVKit presentation crashes
  // (see useOpenShelfItem). TV is a regular push, so stacking is fine and back
  // returns to this card.
  const handlePlay = useCallback(async () => {
    if (!details) return;
    // A photo opens the viewer, not the player. The folder it lives in is the
    // set the viewer steps through: the folder the press came from when there
    // is one, its album otherwise.
    if (isPhoto(details)) {
      void commitClearProgress();
      const folderId = params.inFolderId ?? details.ParentId;
      if (!folderId) return;
      if (!IS_TV) router.back();
      router.push({ pathname: "/photo-viewer", params: { folderId, photoId: details.Id } });
      return;
    }
    // The removal lands before the player opens: openItem reads the resume ticks off this
    // object, and a DELETE in flight would reset the position the player has begun reporting.
    if (pendingClearRef.current) showGlobalLoader();
    const cleared = await commitClearProgress();
    const item = cleared ? { ...details, UserData: { ...details.UserData, PlaybackPositionTicks: 0, Played: false } } : details;
    openItem(item, { replace: !IS_TV });
  }, [commitClearProgress, details, openItem, params.inFolderId, router, showGlobalLoader]);

  // Play everything of one kind under a container. Same phone/TV rule as handlePlay.
  const handlePlayFolder = useCallback(
    (kind: FolderPlayKind) => {
      if (!details) return;
      void playFolder(details, kind, { replace: !IS_TV });
    },
    [details, playFolder],
  );

  // Browse into a container that holds nothing playable. Dismiss first on both platforms,
  // for the reasons handleShowInFolder documents: the panel is a modal on phone, and a
  // "/[folderId]" push from this root screen forks a duplicate (tabs) stack on TV.
  const handleOpenFolder = useCallback(() => {
    if (!details) return;
    router.back();
    openItem(details);
  }, [details, openItem, router]);

  const toggleFavorite = useCallback(async (): Promise<boolean> => {
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      await setVideoFavorite(params.videoId, next);
      return true;
    } catch (error) {
      setIsFavorite(!next);
      logger.warn("Failed to toggle favorite", error, { service: "VideoInfo", videoId: params.videoId });
      return false;
    }
  }, [isFavorite, params.videoId]);

  const toggleWatched = useCallback(async (): Promise<boolean> => {
    const next = !isPlayed;
    setIsPlayed(next);
    try {
      await setVideoPlayed(params.videoId, next);
      return true;
    } catch (error) {
      setIsPlayed(!next);
      logger.warn("Failed to toggle played", error, { service: "VideoInfo", videoId: params.videoId });
      return false;
    }
  }, [isPlayed, params.videoId]);

  // The panel stays open: the confirmation states the total and the space left, and backing
  // out from under it would take the numbers away before they could be read.
  const handleDownloadFolder = useCallback(() => {
    if (!details) return;
    void downloadFolder(details);
  }, [details, downloadFolder]);

  const handleShowInFolder = useCallback(() => {
    if (!details) return;
    // Dismiss the panel first, both platforms. Phone: pushing over a presented modal
    // breaks (see handlePlay). TV: with this root screen focused, a "/[folderId]" push
    // diverges at the ROOT stack and pushes a duplicate (tabs) instance, so Menu can't
    // walk the folder levels. The hook's ancestor fetch runs before any push.
    router.back();
    void showInFolder(details);
  }, [details, router, showInFolder]);

  // Arm or disarm the removal. Which write it will be is decided here, while details are in
  // hand: a started item clears its server resume point, a next-up card has nothing started
  // server-side and its removal is the session-local container dismissal.
  const toggleClearProgress = useCallback((): boolean => {
    if (!details) return false;
    if (pendingClearRef.current) {
      pendingClearRef.current = null;
      setClearArmed(false);
      return true;
    }
    const started = (details.UserData?.PlaybackPositionTicks ?? 0) > 0;
    const container = started ? undefined : containerKey(details);
    if (!started && !container) return false;
    pendingClearRef.current = { id: details.Id, container };
    setClearArmed(true);
    return true;
  }, [details]);

  const title = details?.Name ?? params.name ?? "";
  const audio = details ? isAudioItem(details) : false;
  const photo = details ? isPhoto(details) : false;
  const isContainer = details ? isFolder(details) : false;
  // Audio, video or any mix of the two. Gated on what the container actually holds, so a
  // photo album never offers to download a set the downloads screen could not play.
  const canDownloadFolder = isContainer && downloadsSupported() && !!mediaKinds && (mediaKinds.video || mediaKinds.audio);

  // A container's CTAs follow what it holds. Holding one kind, the button says "Play All";
  // holding several, each one names its own set. A folder with nothing playable keeps the
  // browse action instead, so the row is never empty.
  const kindsHeld = mediaKinds ? [mediaKinds.video, mediaKinds.audio, mediaKinds.photo].filter(Boolean).length : 0;
  const musical = !!details && (details.Type === "MusicAlbum" || details.Type === "MusicArtist" || details.CollectionType === "music");
  const folderCtas: { kind: FolderPlayKind; title: string; icon: keyof typeof Ionicons.glyphMap }[] = !mediaKinds
    ? []
    : [
        ...(mediaKinds.video ? [{ kind: "video" as const, title: kindsHeld > 1 ? "Play Videos" : "Play All", icon: "play" as const }] : []),
        ...(mediaKinds.audio ? [{ kind: "audio" as const, title: kindsHeld > 1 ? (musical ? "Play Music" : "Play Audio") : "Play All", icon: "musical-notes" as const }] : []),
        ...(mediaKinds.photo ? [{ kind: "photo" as const, title: "Slideshow", icon: "images-outline" as const }] : []),
      ];
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
  // The lane needs SecureStore and a native probe, so it lands after the panel paints. The row
  // holds its line from the first frame and the CTAs below it never move. Streams are what the
  // load effect gates the prediction on, so nothing else reserves a line it will never use.
  const lanePending = !laneSettled && !!details?.MediaStreams?.length;

  const logoUri = details?.ImageTags?.Logo ? getLogoUrl(details.Id, 200, details.ImageTags.Logo) : "";
  const posterUri = details && hasPoster(details) ? getPosterUrl(details.Id, IS_TV ? 600 : 300) : "";
  // Hero: real backdrop preferred, sharp Primary cover-cropped otherwise.
  const heroUri = details?.BackdropImageTags?.length ? getBackdropUrl(details.Id) : posterUri;

  const handleHeroLoad = (event: { source?: { width: number; height: number } | null }) => {
    const source = event.source;
    if (!source?.width || !source.height) return;
    setHeroAspect(source.width / source.height);
  };

  // Taller than the box: full width at the source's own ratio, pinned to the top, the foot
  // clipped by the hero. Wider: the plain cover fill, which crops the sides evenly.
  const heroHeight = heroWidth > 0 ? heroHeightFor(heroWidth, !!heroUri) : 0;
  const heroCropStyle =
    heroWidth > 0 && heroHeight > 0 && heroAspect != null && heroAspect < heroWidth / heroHeight
      ? { position: "absolute" as const, top: 0, left: 0, width: heroWidth, height: heroWidth / heroAspect }
      : StyleSheet.absoluteFill;

  // The artwork is transparent until its crop frame is final, so the first painted frame
  // already sits where it belongs and the fade stands in for the shift. Honors Reduce Motion.
  useEffect(() => {
    if (heroAspect == null || !heroMeasured) return;
    heroFade.value = reducedMotion ? 1 : withTiming(1, { duration: 260, easing: Easing.out(Easing.quad) });
  }, [heroAspect, heroMeasured, heroFade, reducedMotion]);
  const heroFadeStyle = useAnimatedStyle(() => ({ opacity: heroFade.value }));

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
        {isContainer ? (
          folderCtas.length > 0 ? (
            folderCtas.map((cta, index) => (
              <FocusableButton
                key={cta.kind}
                title={cta.title}
                variant={index === 0 ? "primary" : "secondary"}
                hasTVPreferredFocus={index === 0}
                icon={<Ionicons name={cta.icon} size={IS_TV ? 34 : 22} color={index === 0 ? COLORS.ON_ACCENT : COLORS.ACCENT} />}
                onPress={() => handlePlayFolder(cta.kind)}
              />
            ))
          ) : (
            <FocusableButton
              title="Open"
              variant="primary"
              hasTVPreferredFocus
              icon={<Ionicons name="folder-open-outline" size={IS_TV ? 34 : 22} color={COLORS.ON_ACCENT} />}
              onPress={handleOpenFolder}
            />
          )
        ) : (
          <ProgressButton
            title={photo ? "View" : details.UserData?.PlaybackPositionTicks ? "Resume" : "Play"}
            variant="primary"
            hasTVPreferredFocus
            icon={<Ionicons name={photo ? "expand" : "play"} size={IS_TV ? 34 : 22} color={COLORS.ON_ACCENT} />}
            onPress={handlePlay}
            progress={cardResumeProgress(details)}
          />
        )}
        {!!folderLeafId && folderLeafId !== params.inFolderId && (
          <FocusableButton title="Show in Folder" variant="secondary" icon={<Ionicons name="folder-outline" size={IS_TV ? 34 : 22} color={COLORS.ACCENT} />} onPress={handleShowInFolder} />
        )}
        {/* Containers only: a leaf has the download circle in the action row below. "All" in
            the sense the play CTAs use it, and it stays "All" even where they split by kind:
            whatever mix of audio and video the folder holds comes down in this one press. */}
        {canDownloadFolder && (
          <FocusableButton title="Download All" variant="secondary" icon={<Ionicons name="arrow-down-circle-outline" size={IS_TV ? 34 : 22} color={COLORS.ACCENT} />} onPress={handleDownloadFolder} />
        )}
      </View>

      {/* Leaves only. A container's favorite is written but never readable: the favorite-id
          sweep is a MediaTypes flatten, which no folder is in, and a favorited library is
          absent even from the unfiltered recursive query (measured, 10.11.11). Its "Watched"
          is not a flag either — Folder.MarkPlayed sweeps every descendant and resets each
          resume position, which no card here could state. */}
      {!isContainer && (
        <View style={styles.actionRow}>
          <InfoActionRow
            isFavorite={isFavorite}
            isPlayed={isPlayed}
            cleared={clearArmed}
            onToggleFavorite={toggleFavorite}
            onToggleWatched={toggleWatched}
            // Any item with progress can clear it; fromResume also covers next-up cards
            // (zero progress, where removal is the session-local container dismissal).
            onToggleProgress={!!params.fromResume || (details.UserData?.PlaybackPositionTicks ?? 0) > 0 ? toggleClearProgress : undefined}
            downloadState={downloadState}
            onToggleDownload={toggleDownload}
          />
        </View>
      )}

      {!!tagline && <Text style={styles.tagline}>{tagline}</Text>}
      {!!details.Overview && (
        <InfoFocusRow style={styles.overviewBlock}>
          {overviewParagraphs(details.Overview).map((paragraph, index) => (
            <Text key={index} style={[styles.overview, index > 0 && styles.overviewNext]}>
              {paragraph}
            </Text>
          ))}
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
    // The spinner is a focus stop on purpose: presenting a screen with nothing focusable on it
    // leaves focus outside the panel until the fetch resolves and a CTA claims it.
    <View style={styles.stateWrap}>
      <InfoFocusRow hasTVPreferredFocus>
        <ActivityIndicator size="large" color={COLORS.ACCENT} accessibilityLabel={`Loading details for ${title || "this item"}`} />
      </InfoFocusRow>
    </View>
  ) : (
    <ScrollView style={styles.scroll} contentContainerStyle={{ paddingBottom: IS_TV ? 48 : insets.bottom + 28 }} showsVerticalScrollIndicator={false}>
      {/* Full-bleed artwork heading on both platforms; the scrim fades it into
          the panel. Artless items keep the same hero with the brand face
          (layer-front) centered in it — the cards' no-poster mark. */}
      <View
        style={[styles.hero, heroHeight > 0 && { height: heroHeight }]}
        onLayout={(event) => {
          setHeroWidth(event.nativeEvent.layout.width);
          setHeroMeasured(true);
        }}>
        {heroUri ? (
          <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, heroFadeStyle]}>
            <Image
              key={heroUri}
              source={{ uri: heroUri }}
              style={heroCropStyle}
              contentFit="cover"
              transition={0}
              cachePolicy="memory-disk"
              onLoad={handleHeroLoad}
              accessible
              accessibilityLabel={`${title} artwork`}
            />
          </Animated.View>
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
      <View style={[styles.heroTitleWrap, logoUri ? styles.heroLogoBelow : styles.heroTitleBelow, !IS_TV && { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }]}>
        {logoUri ? (
          <Image
            source={{ uri: logoUri }}
            style={[styles.heroLogo, { width: Math.max(0, heroWidth - (IS_TV ? 0 : 40)) }]}
            contentFit="contain"
            transition={200}
            accessible
            accessibilityLabel={title}
          />
        ) : (
          <Text style={styles.heroTitle} numberOfLines={2}>
            {title}
          </Text>
        )}
        {!!contextLine && <Text style={styles.heroContext}>{contextLine}</Text>}
      </View>
      <View style={IS_TV ? styles.tvPad : { paddingLeft: 20 + insets.left, paddingRight: 20 + insets.right }}>
        {!!metaLine && <Text style={[styles.metaLine, styles.metaBlock]}>{metaLine}</Text>}
        {(!!laneLabel || lanePending) && (
          <View style={[styles.laneRow, styles.laneBlock]}>
            {!!laneLabel && <View style={[styles.laneDot, { backgroundColor: laneColor }]} />}
            {/* A space, not a height: the placeholder is the same line box the label will fill. */}
            <Text style={styles.laneText} accessibilityElementsHidden={!laneLabel}>
              {laneLabel || " "}
            </Text>
          </View>
        )}
        {sections}
      </View>
    </ScrollView>
  );

  if (IS_PAD) {
    return (
      <View style={styles.padRoot}>
        {/* The route is presented over the app (UIModalPresentationOverFullScreen), which leaves
            the library in the window for this UIVisualEffectView to sample. iOS has no blurred
            presentation style of its own: UIModalPresentationBlurOverFullScreen is tvOS only. */}
        <BlurView intensity={40} tint="dark" style={StyleSheet.absoluteFill} />
        {/* The dim rides on the dismiss target: blurred artwork is still bright artwork, and it
            is what hides the library if a device gives us no blur. */}
        <Pressable style={[StyleSheet.absoluteFill, styles.padDim]} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close the video info panel" />
        {/* The page sheet's own frame: same width, same top gap, flush to the bottom. */}
        <View style={[styles.padSheet, { width: Math.round(windowWidth * PAD_SHEET_RATIO), marginTop: insets.top + 8 }]}>
          {body}
          <CloseOverlayButton onPress={() => router.back()} style={styles.padClose} accessibilityHint="Closes the video info panel" />
        </View>
      </View>
    );
  }

  if (!IS_TV) {
    return (
      <View style={styles.sheetRoot}>
        {body}
        <CloseOverlayButton onPress={() => router.back()} style={{ position: "absolute", top: 12, right: 12 + insets.right }} accessibilityHint="Closes the video info panel" />
      </View>
    );
  }

  return (
    <TVFocusGuideView style={styles.flex} trapFocusUp autoFocus>
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
  // iPad: no background of its own, the blur behind the card is the surface.
  padRoot: {
    flex: 1,
    alignItems: "center",
  },
  padDim: {
    backgroundColor: "rgba(0, 0, 0, 0.45)",
  },
  // BACKGROUND, not the section's SURFACE: the hero gradient's bottom stop is the phone
  // colour, and a lighter surface under it would show a seam across the artwork.
  padSheet: {
    flex: 1,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    overflow: "hidden",
    backgroundColor: COLORS.BACKGROUND,
  },
  padClose: {
    position: "absolute",
    top: 12,
    right: 12,
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
    // The top-anchored crop overhangs the foot of the hero.
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
  // Centred on the same axis as the CTA rows below, so the panel reads as one column.
  // Everything from the overview down stays flush left.
  // No alignItems: the two Texts centre themselves with textAlign, and centring here would
  // stop heroLogo stretching, leaving its percentage width nothing to resolve against.
  heroTitleWrap: {
    paddingBottom: IS_TV ? 14 : 10,
    paddingHorizontal: IS_TV ? 48 : 0,
  },
  heroTitleBelow: {
    marginTop: IS_TV ? 5 : 16,
  },
  // A logo rides up into the foot of the artwork on TV, where the scrim has already faded it to
  // the surface. Text never does — a title over the picture is what the scrim exists to avoid —
  // and the phone's hero is too short to give any of it away.
  heroLogoBelow: {
    marginTop: IS_TV ? -100 : 10,
  },
  heroTitle: {
    fontSize: IS_TV ? 44 : 30,
    fontWeight: "700",
    color: COLORS.TEXT_PRIMARY,
    textAlign: "center",
  },
  heroContext: {
    fontSize: IS_TV ? 24 : 15,
    fontWeight: "500",
    color: "rgba(255, 255, 255, 0.9)",
    marginTop: IS_TV ? 8 : 4,
    textAlign: "center",
  },
  // Full width, or "contain" centres the art inside a 60% box that starts after the wrap's
  // left padding — off the card's axis. Height is what actually binds a wide logo's size.
  // Width comes measured, not as a percentage: contain then binds on width for a wide mark,
  // and the default centre position needs no string that could parse to an edge.
  // Bleeds past the wrap's padding so the mark can use the card's full width; the context
  // line beside it keeps its own inset.
  heroLogo: {
    height: IS_TV ? 190 : 84,
    marginHorizontal: IS_TV ? -48 : 0,
  },
  // Interior padding for everything below the hero on TV; phone uses inset-aware inline padding.
  tvPad: {
    paddingHorizontal: 48,
  },
  metaBlock: {
    marginTop: IS_TV ? 18 : 12,
  },
  laneBlock: {
    marginTop: 8,
  },
  metaLine: {
    fontSize: IS_TV ? 22 : 14,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
  laneRow: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "center",
    gap: IS_TV ? 10 : 6,
  },
  laneDot: {
    width: IS_TV ? 10 : 7,
    height: IS_TV ? 10 : 7,
    borderRadius: 999,
  },
  laneText: {
    fontSize: IS_TV ? 21 : 13,
    color: COLORS.TEXT_SECONDARY,
  },
  // Content-sized buttons (FocusableButton's own min width), centered in the panel. A
  // container can carry four (videos, audio, slideshow, show in folder), past the width of
  // the 1100pt TV card and of a landscape phone, so the row wraps.
  ctaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignSelf: "center",
    justifyContent: "center",
    gap: IS_TV ? 28 : 16,
    marginTop: IS_TV ? 28 : 22,
  },
  // Portrait stack: one width for the whole stack, taken from the widest button. Hierarchy
  // is fill against outline, never button size.
  ctaColumn: {
    flexDirection: "column",
    alignItems: "stretch",
    gap: 22,
  },
  actionRow: {
    marginTop: IS_TV ? 52 : 34,
  },
  tagline: {
    fontSize: IS_TV ? 25 : 15,
    fontStyle: "italic",
    color: COLORS.TEXT_SECONDARY,
    marginTop: IS_TV ? 28 : 18,
  },
  overviewBlock: {
    marginTop: IS_TV ? 16 : 12,
  },
  // No maxWidth: the focus block behind it spans the column, so a capped measure leaves a
  // gap inside the highlight. Leading carries the readability instead.
  overview: {
    fontSize: IS_TV ? 22 : 15,
    lineHeight: IS_TV ? 34 : 23,
    color: "rgba(255, 255, 255, 0.94)",
  },
  overviewNext: {
    marginTop: IS_TV ? 18 : 12,
  },
  studios: {
    fontSize: IS_TV ? 21 : 13,
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
    fontSize: IS_TV ? 23 : 15,
    fontWeight: "600",
    color: COLORS.TEXT_PRIMARY,
  },
  streamDetail: {
    fontSize: IS_TV ? 21 : 13,
    color: COLORS.TEXT_SECONDARY,
    marginTop: 2,
  },
  // The path is the longest thing on the panel and the least urgent — it wraps
  // rather than truncating, so a file can always be located from what is shown.
  filePath: {
    fontSize: IS_TV ? 18 : 12,
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
    width: IS_TV ? 200 : 122,
    fontSize: IS_TV ? 21 : 13,
    color: COLORS.TEXT_TERTIARY,
  },
  detailValue: {
    flex: 1,
    fontSize: IS_TV ? 23 : 15,
    color: COLORS.TEXT_PRIMARY,
  },
});
