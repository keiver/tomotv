import { FocusableButton } from "@/components/FocusableButton";
import { GlassSurface } from "@/components/glass-surface";
import { INFO_PILL_RADIUS, PageViewer, pageViewerStyles, type PageViewerHandle } from "@/components/page-viewer";
import { COLORS } from "@/constants/colors";
import { closeBook, isBookRendererAvailable, openBook, relayoutBook, renderPage, type BookLayout, type OpenedBook } from "@/services/bookRenderer";
import { ensureBookFile } from "@/services/books/file";
import { bookKind } from "@/services/books/kinds";
import { ReadingProgress, pageForTicks } from "@/services/books/progress";
import { t } from "@/services/i18n";
import { fetchItemDetails } from "@/services/jellyfinApi";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { getLoadErrorMessage } from "@/utils/errorClassification";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, BackHandler, PixelRatio, Platform, StyleSheet, Text, View, useWindowDimensions } from "react-native";

/** Body sizes in points; the middle one is the default. */
const FONT_SIZES = Platform.isTV ? [30, 36, 42, 48] : [16, 19, 22, 26];
const DEFAULT_FONT_STEP = 1;
/** Pages rendered ahead and behind the one on screen. */
const PRERENDER_WINDOW = 2;
/** Darker than the photo viewer's material: book pages are white paper, and the pill has to read on them. */
const READER_CHROME_TINT = "rgba(18, 18, 20, 0.55)";

type PageUris = Record<number, Partial<Record<number, string>>>;

/**
 * Full-screen reader for Jellyfin Book items: the file comes down to Caches, the native
 * renderer turns it into page images, the page viewer steps and zooms them. Fixed layouts
 * (pdf, comics) zoom by re-rendering at the settled level; text books (epub, mobi, azw3)
 * step their font size instead and relayout on rotation. The place is written back as the
 * server's own ticks encoding, so the web client resumes at the same spot.
 */
export default function BookReaderScreen() {
  const params = useLocalSearchParams<{ itemId: string; name?: string }>();
  const router = useRouter();
  const { width: viewportWidth, height: viewportHeight } = useWindowDimensions();
  const scale = PixelRatio.get();

  const [details, setDetails] = useState<JellyfinVideoItem | null>(null);
  const [book, setBook] = useState<OpenedBook | null>(null);
  const [startIndex, setStartIndex] = useState(0);
  const [index, setIndex] = useState(0);
  const [pages, setPages] = useState(0);
  const [uris, setUris] = useState<PageUris>({});
  const [fontStep, setFontStep] = useState(DEFAULT_FONT_STEP);
  const [error, setError] = useState<string | null>(null);
  const [relaying, setRelaying] = useState(false);

  const viewerRef = useRef<PageViewerHandle>(null);
  const bookRef = useRef<OpenedBook | null>(null);
  const progressRef = useRef<ReadingProgress | null>(null);
  const zoomRef = useRef(1);
  const inFlight = useRef(new Set<string>());
  const layoutRef = useRef<BookLayout>({ pageWidth: viewportWidth, pageHeight: viewportHeight, scale, fontSize: FONT_SIZES[DEFAULT_FONT_STEP] });

  const layout = useMemo<BookLayout>(() => ({ pageWidth: viewportWidth, pageHeight: viewportHeight, scale, fontSize: FONT_SIZES[fontStep] }), [viewportWidth, viewportHeight, scale, fontStep]);
  useEffect(() => {
    layoutRef.current = layout;
  }, [layout]);

  /** One render per (page, zoom), the result kept by page. */
  const render = useCallback(async (at: number, zoom: number) => {
    const opened = bookRef.current;
    if (!opened || at < 0) return;
    const key = `${at}:${zoom}`;
    if (inFlight.current.has(key)) return;
    inFlight.current.add(key);
    try {
      const page = await renderPage(opened.token, at, zoom, layoutRef.current);
      setUris((prev) => (prev[at]?.[zoom] === page.uri ? prev : { ...prev, [at]: { ...prev[at], [zoom]: page.uri } }));
    } catch (err) {
      logger.warn("Book page render failed", err, { service: "BookReader", page: at, zoom });
    } finally {
      inFlight.current.delete(key);
    }
  }, []);

  /** The window around a page at zoom 1, rendered together and committed as one state update. */
  const prerender = useCallback((around: number, total: number) => {
    const opened = bookRef.current;
    if (!opened) return;
    const wanted: number[] = [];
    for (let offset = 0; offset <= PRERENDER_WINDOW; offset++) {
      for (const at of offset === 0 ? [around] : [around + offset, around - offset]) {
        if (at >= 0 && at < total && !inFlight.current.has(`${at}:1`)) wanted.push(at);
      }
    }
    if (wanted.length === 0) return;
    wanted.forEach((at) => inFlight.current.add(`${at}:1`));
    void Promise.all(
      wanted.map((at) =>
        renderPage(opened.token, at, 1, layoutRef.current)
          .then((page) => [at, page.uri] as const)
          .catch((err) => {
            logger.warn("Book page render failed", err, { service: "BookReader", page: at, zoom: 1 });
            return null;
          }),
      ),
    ).then((results) => {
      wanted.forEach((at) => inFlight.current.delete(`${at}:1`));
      if (bookRef.current !== opened) return;
      setUris((prev) => {
        let next = prev;
        for (const result of results) {
          if (!result) continue;
          const [at, uri] = result;
          if (next[at]?.[1] === uri) continue;
          if (next === prev) next = { ...prev };
          next[at] = { ...next[at], 1: uri };
        }
        return next;
      });
    });
  }, []);

  // Open: details, file, native book, resume page.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!isBookRendererAvailable()) throw new Error(t("reader.notInBuild"));
        // fetchItemDetails, not fetchVideoDetails: /Items/{id}/PlaybackInfo answers 500 for a Book.
        const item = await fetchItemDetails(params.itemId);
        if (cancelled) return;
        if (!item) throw new Error(t("reader.noLongerOnServer"));
        const kind = bookKind(item);
        if (!kind) throw new Error(t("reader.noReaderFor").replace("{ext}", item.Path?.split(".").pop() ?? "this"));
        setDetails(item);
        const path = await ensureBookFile(item);
        if (cancelled) return;
        const opened = await openBook(path, layoutRef.current);
        if (cancelled) {
          void closeBook(opened.token);
          return;
        }
        bookRef.current = opened;
        progressRef.current = new ReadingProgress(item.Id, opened.kind);
        const resume = pageForTicks(opened.kind, item.UserData?.PlaybackPositionTicks, opened.pages);
        setPages(opened.pages);
        setStartIndex(resume);
        setIndex(resume);
        setBook(opened);
        progressRef.current.start(resume, opened.pages);
        prerender(resume, opened.pages);
      } catch (err) {
        if (cancelled) return;
        const message = (err as { code?: string })?.code === "locked" ? t("reader.locked") : getLoadErrorMessage(err);
        setError(message);
        logger.error("Error opening book", err, { service: "BookReader", itemId: params.itemId });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [params.itemId, prerender]);

  // Leave: the last place written, the native book closed.
  useEffect(() => {
    return () => {
      void progressRef.current?.flush();
      const opened = bookRef.current;
      bookRef.current = null;
      if (opened) void closeBook(opened.token);
    };
  }, []);

  const handleIndexChange = useCallback(
    (next: number) => {
      setIndex(next);
      const total = bookRef.current?.pages ?? 0;
      progressRef.current?.note(next, total);
      prerender(next, total);
    },
    [prerender],
  );

  // A zoom that settled above 1 gets a sharper render of the page on screen.
  const handleZoomSettled = useCallback(
    (level: number) => {
      zoomRef.current = level;
      if (level > 1 && bookRef.current?.kind === "fixed") void render(viewerRef.current?.index() ?? index, level);
    },
    [render, index],
  );

  // Text books: a new font size or viewport repaginates, one at a time. Native reads the page index
  // against its current layout, so a queued relayout starts from the page the previous one landed on.
  const relayoutQueueRef = useRef<Promise<void>>(Promise.resolve());
  const queuedRelayoutsRef = useRef(0);
  const landedPageRef = useRef<number | null>(null);
  const relayout = useCallback(
    (next: BookLayout) => {
      queuedRelayoutsRef.current += 1;
      const run = async () => {
        try {
          const opened = bookRef.current;
          if (!opened || opened.kind !== "text") return;
          setRelaying(true);
          const current = landedPageRef.current ?? viewerRef.current?.index() ?? 0;
          const result = await relayoutBook(opened.token, current, next);
          landedPageRef.current = result.page;
          bookRef.current = { ...opened, pages: result.pages };
          setBook(bookRef.current);
          setUris({});
          setPages(result.pages);
          setIndex(result.page);
          viewerRef.current?.goTo(result.page, 1, "fade");
          progressRef.current?.start(result.page, result.pages);
          prerender(result.page, result.pages);
        } catch (err) {
          logger.warn("Book relayout failed", err, { service: "BookReader" });
        } finally {
          queuedRelayoutsRef.current -= 1;
          if (queuedRelayoutsRef.current === 0) {
            landedPageRef.current = null;
            setRelaying(false);
          }
        }
      };
      relayoutQueueRef.current = relayoutQueueRef.current.then(run);
      return relayoutQueueRef.current;
    },
    [prerender],
  );

  const stepFont = useCallback(
    (delta: 1 | -1) => {
      const next = Math.min(Math.max(fontStep + delta, 0), FONT_SIZES.length - 1);
      if (next === fontStep) return;
      setFontStep(next);
      void relayout({ ...layoutRef.current, fontSize: FONT_SIZES[next] });
    },
    [fontStep, relayout],
  );

  const cycleFont = useCallback(() => {
    const next = (fontStep + 1) % FONT_SIZES.length;
    setFontStep(next);
    void relayout({ ...layoutRef.current, fontSize: FONT_SIZES[next] });
  }, [fontStep, relayout]);

  // Rotation: a text book keeps its font at the new page size; a fixed book rasterises again.
  const lastViewport = useRef({ width: viewportWidth, height: viewportHeight });
  useEffect(() => {
    if (lastViewport.current.width === viewportWidth && lastViewport.current.height === viewportHeight) return;
    lastViewport.current = { width: viewportWidth, height: viewportHeight };
    const opened = bookRef.current;
    if (!opened) return;
    if (opened.kind === "text") {
      void relayout({ ...layoutRef.current, pageWidth: viewportWidth, pageHeight: viewportHeight });
      return;
    }
    const current = viewerRef.current?.index() ?? 0;
    setUris({});
    prerender(current, opened.pages);
    if (zoomRef.current > 1) void render(current, zoomRef.current);
  }, [viewportWidth, viewportHeight, relayout, prerender, render]);

  const leave = useCallback(() => router.back(), [router]);
  const nextPage = useCallback(() => viewerRef.current?.step(1), []);

  // Handle Android TV back button
  useEffect(() => {
    if (Platform.OS === "android") {
      const backHandler = BackHandler.addEventListener("hardwareBackPress", () => {
        router.back();
        return true;
      });
      return () => backHandler.remove();
    }
  }, [router]);

  // The sharpest render at or below the settled zoom, the base render otherwise.
  const uriAt = useCallback(
    (at: number) => {
      const levels = uris[at];
      if (!levels) return "";
      for (let level = zoomRef.current; level >= 1; level--) {
        const uri = levels[level];
        if (uri) return uri;
      }
      return "";
    },
    [uris],
  );

  const title = book?.title || details?.Name || params.name || "";

  if (error) {
    return (
      <View style={pageViewerStyles.errorContainer}>
        <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
        <Text style={pageViewerStyles.errorTitle}>{t("reader.unableToLoad")}</Text>
        <Text style={pageViewerStyles.errorText}>{error}</Text>
        <FocusableButton title={t("common.goBack")} onPress={leave} variant="secondary" style={pageViewerStyles.button} hasTVPreferredFocus={true} />
      </View>
    );
  }

  if (!book) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={COLORS.TEXT_PRIMARY} />
        {!!title && <Text style={styles.loadingTitle}>{title}</Text>}
      </View>
    );
  }

  const isText = book.kind === "text";
  const overlay = (
    <GlassSurface style={pageViewerStyles.infoPill} radius={INFO_PILL_RADIUS} tintColor={READER_CHROME_TINT} pointerEvents="none">
      {relaying && <ActivityIndicator size="small" color={COLORS.TEXT_SECONDARY} />}
      <Text style={pageViewerStyles.infoName} numberOfLines={1}>
        {title}
      </Text>
      <Text style={pageViewerStyles.infoCounter}>
        {index + 1} / {pages}
      </Text>
    </GlassSurface>
  );

  return (
    <PageViewer
      ref={viewerRef}
      pages={pages}
      uriAt={uriAt}
      initialIndex={startIndex}
      onIndexChange={handleIndexChange}
      onLeave={leave}
      onSelect={nextPage}
      onPlayPause={isText ? cycleFont : undefined}
      actions={
        isText
          ? [
              { key: "smaller", icon: "remove", label: t("reader.smallerText"), onPress: () => stepFont(-1), keepOpen: true },
              { key: "bigger", icon: "add", label: t("reader.biggerText"), onPress: () => stepFont(1), keepOpen: true },
            ]
          : []
      }
      holdChrome={relaying}
      triggerLabel={t("reader.bookActions")}
      overlay={overlay}
      zoomMode="image"
      onZoomSettled={handleZoomSettled}
      accessibilityLabel={t("reader.bookName").replace("{title}", title)}
      accessibilityHint={t("reader.next")}
      previousLabel={t("reader.previous")}
      nextLabel={t("reader.next")}
      keyOwner="book-reader"
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: COLORS.MEDIA_BACKGROUND,
    justifyContent: "center",
    alignItems: "center",
    gap: 20,
  },
  loadingTitle: {
    fontSize: Platform.isTV ? 24 : 16,
    color: COLORS.TEXT_SECONDARY,
  },
});
