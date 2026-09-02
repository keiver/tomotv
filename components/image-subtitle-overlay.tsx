import { fetchImageSubtitleTrack, imageSubtitleUrl, imagesAt, type ImageSubtitleImage, type ImageSubtitleTrack } from "@/services/localRemux";
import { logger } from "@/utils/logger";
import { Image } from "expo-image";
import React, { useEffect, useMemo, useState } from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";

/**
 * Draws bitmap subtitles (PGS, DVD/VobSub, DVB, XSUB) over the video, since
 * AVPlayer has no renderer for them.
 *
 * Rendered as a CHILD of <Video>, which react-native-video inserts into the
 * AVPlayerViewController's contentOverlayView (RCTVideo.insertReactSubview).
 * Apple documents that layer as holding views "between the video content and
 * the controls", but a bitmap has been photographed drawing across the
 * transport bar on tvOS 26, so the z-order is not settled either way.
 *
 * It does not need to be. While the controls are up the images are kept inside
 * AVKit's unobscuredContentGuide, which is the supported answer to "where will
 * the chrome not cover me" and is what AVKit does with its own captions. The
 * guide arrives on onControlsVisibilityChange.
 */

type Props = {
  /** Loopback master URL of the running engine session, or null. */
  sessionUrl: string | null;
  /** Source stream index the viewer selected, or null when subtitles are off. */
  streamIndex: number | null;
  /**
   * Live playback position, sampled rather than passed as a changing prop.
   *
   * Feeding the clock down as state re-rendered the entire player screen four
   * times a second, which on a real Apple TV competed with H.264 decode, FLAC
   * encode and the loopback server for the main thread. This component polls
   * the ref instead and only re-renders when the visible images change.
   */
  currentTimeRef: React.RefObject<number>;
  /** Video's intrinsic size, for the letterbox maths. */
  videoWidth: number;
  videoHeight: number;
  /** True while the video is aspect-FILL, so the cue rect is cropped rather than letterboxed. */
  fills?: boolean;
  /** AVKit's transport controls are on screen; lift images clear of them. */
  controlsVisible: boolean;
  /**
   * Bottom edge of AVPlayerViewController.unobscuredContentGuide, in this
   * view's coordinates: the lowest point AVKit says its fixed-position controls
   * will not cover. Null off tvOS, and null if AVKit reports nothing usable.
   */
  unobscuredBottom: number | null;
};

/**
 * The manifest is empty when a track is first selected — selection happens as
 * the player loads, before the engine has demuxed anything — so it is refetched
 * while the engine is still reading.
 *
 * There is deliberately no "we already hold enough" shortcut. The obvious one,
 * comparing how far the engine has read against the playhead, cannot fire:
 * `Remuxer.aheadWindow` is 5 segments of 6s, so the read head is never more than
 * about 30 seconds in front, and any threshold small enough to trigger would be
 * a constant tuned to another module's internals. Publishing is skipped instead
 * when a response carries nothing new, which costs a fetch but no render.
 */
const MANIFEST_REFRESH_MS = 3_000;

/**
 * Once the engine reports the track final, ask this rarely rather than stopping.
 *
 * Complete means the read loop reached EOF, which is NOT the same as having read
 * the whole file: a resume starts the pipeline mid-item, so the first generation
 * can reach the end having never seen the head of it. Seeking back there decodes
 * display sets for the first time, and a poll that had stopped for good would
 * never collect them.
 */
const COMPLETE_REFRESH_MS = 60_000;

/** Clock sample rate. Only a change in the visible set costs a render. */
const IMAGE_TICK_MS = 250;

/**
 * Fallback for the lowest an image may sit while the controls are up, as a
 * fraction of view height, used only when AVKit reports no
 * `unobscuredContentGuide` — off tvOS, or if the guide comes back empty.
 *
 * It is a guess, which is why the guide is preferred whenever it exists: the
 * real chrome height is Apple's to change and has no fixed relationship to the
 * screen.
 */
const CONTROLS_SAFE_BOTTOM = 0.74;

export function ImageSubtitleOverlay({ sessionUrl, streamIndex, currentTimeRef, videoWidth, videoHeight, fills = false, controlsVisible, unobscuredBottom }: Props) {
  // The loaded manifest is stamped with the selection it belongs to, and read
  // back only for the selection currently in force. Deselecting therefore drops
  // the bitmaps during render rather than in an effect, so the previous track's
  // images can never be painted for a frame after the viewer switched away.
  const [loaded, setLoaded] = useState<{ key: string; track: ImageSubtitleTrack } | null>(null);
  const [images, setImages] = useState<ImageSubtitleImage[]>([]);
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const trackKey = sessionUrl && streamIndex !== null ? `${sessionUrl}#${streamIndex}` : null;
  const track = trackKey !== null && loaded?.key === trackKey ? loaded.track : null;

  // Fetch the manifest on selection, then keep refreshing: the engine decodes
  // display sets as it demuxes, so the track is empty when first selected.
  useEffect(() => {
    if (!sessionUrl || streamIndex === null || trackKey === null) return;

    // Per selection, so switching tracks starts clean without any reset step.
    let cancelled = false;
    let lastSignature = "";
    let complete = false;
    let lastFetchAt = 0;

    const load = async () => {
      const now = Date.now();
      if (complete && now - lastFetchAt < COMPLETE_REFRESH_MS) return;
      lastFetchAt = now;

      const next = await fetchImageSubtitleTrack(sessionUrl, streamIndex);
      if (cancelled || !next) return;
      complete = next.complete;

      // Nothing new decoded and nothing further read. Publishing it anyway
      // would re-render the overlay every few seconds for the length of a film.
      const signature = `${next.events.length}:${next.demuxedUpTo}:${next.complete}`;
      if (signature === lastSignature) return;
      lastSignature = signature;

      logger.debug("Image subtitle sets", {
        service: "ImageSubtitles",
        streamIndex,
        position: Number((currentTimeRef.current ?? 0).toFixed(2)),
        sets: next.events.length,
        readUpTo: Number(next.demuxedUpTo.toFixed(2)),
        complete: next.complete,
        canvas: `${next.canvasWidth}x${next.canvasHeight}`,
      });
      setLoaded({ key: trackKey, track: next });
    };

    load();
    const timer = setInterval(load, MANIFEST_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sessionUrl, streamIndex, trackKey, currentTimeRef]);

  // Sample the clock and publish only when what is on screen changes. Rendering
  // is therefore driven by the subtitles themselves, not by the frame rate.
  useEffect(() => {
    if (!track) return;
    // Null rather than "", so the first tick always publishes: a new track whose
    // first display set is an erase would otherwise match the initial signature
    // and leave the previous track's images in state.
    let signature: string | null = null;
    const tick = () => {
      const now = currentTimeRef.current ?? 0;
      const next = imagesAt(track.events, now);
      const nextSignature = next.map((image) => image.file).join("|");
      if (nextSignature === signature) return;
      signature = nextSignature;
      logger.debug("Image subtitle set changed", {
        service: "ImageSubtitles",
        position: Number(now.toFixed(2)),
        showing: next.length,
        files: next.map((image) => image.file).join(","),
      });
      setImages(next);
    };
    tick();
    const timer = setInterval(tick, IMAGE_TICK_MS);
    return () => clearInterval(timer);
  }, [track, currentTimeRef]);

  // PGS coordinates are absolute in the SUBTITLE canvas, which is not always
  // the video's size: T43 declares a 1280x720 canvas over a 720x480 picture.
  // Map canvas -> displayed video rect, matching whichever gravity the player is on: one
  // uniform scale, then centre. Fitting takes the smaller ratio and centres a letterbox;
  // filling takes the larger and the offsets go negative, which centres the crop.
  const layout = useMemo(() => {
    if (!track || track.canvasWidth <= 0 || track.canvasHeight <= 0) return null;
    const intrinsicWidth = videoWidth > 0 ? videoWidth : track.canvasWidth;
    const intrinsicHeight = videoHeight > 0 ? videoHeight : track.canvasHeight;

    const fitScale = windowWidth / intrinsicWidth;
    const otherScale = windowHeight / intrinsicHeight;
    const videoScale = fills ? Math.max(fitScale, otherScale) : Math.min(fitScale, otherScale);
    const displayedWidth = intrinsicWidth * videoScale;
    const displayedHeight = intrinsicHeight * videoScale;

    return {
      scaleX: displayedWidth / track.canvasWidth,
      scaleY: displayedHeight / track.canvasHeight,
      offsetX: (windowWidth - displayedWidth) / 2,
      offsetY: (windowHeight - displayedHeight) / 2,
    };
  }, [track, videoWidth, videoHeight, fills, windowWidth, windowHeight]);

  // With the controls up, lift by however much the lowest image overlaps them,
  // and no further. Shifting every image by the same amount keeps a multi-rect
  // display set (dialogue plus a sign) in its original relative arrangement.
  //
  // Applied to each image's `top`, NOT as a transform on the container.
  // RCTVideo.layoutSubviews forces every subview of contentOverlayView back to
  // `bounds` on every layout pass, and setting a view's frame recomputes its
  // centre through the current transform — so a translate is cancelled almost
  // as soon as it is applied. Positioning cannot be clobbered that way.
  const lift = useMemo(() => {
    if (!controlsVisible || !layout || images.length === 0) return 0;
    const safeBottom = unobscuredBottom !== null && unobscuredBottom > 0 ? unobscuredBottom : windowHeight * CONTROLS_SAFE_BOTTOM;
    const lowestBottom = Math.max(...images.map((image) => layout.offsetY + (image.y + image.height) * layout.scaleY));
    return Math.max(0, lowestBottom - safeBottom);
  }, [controlsVisible, layout, images, windowHeight, unobscuredBottom]);

  useEffect(() => {
    if (!layout || images.length === 0) return;
    logger.debug("Image subtitle layout", {
      service: "ImageSubtitles",
      controlsVisible,
      // Which geometry the lift used. "guide" is AVKit's own answer; "fallback"
      // means the guide never arrived and the guessed fraction is in play,
      // which is worth seeing in a device log rather than inferring.
      source: unobscuredBottom !== null && unobscuredBottom > 0 ? "guide" : "fallback",
      unobscuredBottom: unobscuredBottom === null ? null : Math.round(unobscuredBottom),
      lift: Math.round(lift),
      showing: images.length,
    });
  }, [controlsVisible, lift, layout, images.length, unobscuredBottom]);

  if (!track || !layout || images.length === 0) return null;

  return (
    // pointerEvents="none" and nothing focusable: on tvOS a view above a
    // focusable occludes it for the focus engine, and AVKit's transport
    // controls share this layer.
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {images.map((image) => {
        const uri = imageSubtitleUrl(sessionUrl, image.file);
        if (!uri) return null;
        return (
          <Image
            key={image.file}
            source={{ uri }}
            style={{
              position: "absolute",
              left: layout.offsetX + image.x * layout.scaleX,
              top: layout.offsetY + image.y * layout.scaleY - lift,
              width: image.width * layout.scaleX,
              height: image.height * layout.scaleY,
            }}
            contentFit="fill"
            // Bitmaps are already the right pixels; caching them by URL avoids
            // refetching the same image when the display set is revisited.
            cachePolicy="memory"
            transition={0}
          />
        );
      })}
    </View>
  );
}
