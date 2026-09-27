import { AmbientBackground } from "@/components/ambient-background";
import { FocusableButton } from "@/components/FocusableButton";
import { GlassSurface } from "@/components/glass-surface";
import { LoadingRow } from "@/components/loading-row";
import { PadSheet } from "@/components/pad-sheet";

import { DESIGN } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { useLoadingActions } from "@/contexts/LoadingContext";
import { useLiveTvManagement } from "@/hooks/useLiveTvManagement";
import { t } from "@/services/i18n";
import { cancelSeriesTimer, cancelTimer, createSeriesTimer, createTimer, fetchProgram, fetchTimerDefaults, fetchTimers, hasPoster } from "@/services/jellyfinApi";
import { serverPoster } from "@/services/itemArtwork";
import { getLiveTvPreferences } from "@/services/liveTvPreferences";
import { showToast } from "@/services/toast";
import type { JellyfinProgram, JellyfinTimer } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { activeRecordTimer, durationLabel, formatClock, formatDayLabel, isAiring, programCategory, programTimes } from "@/utils/guide";
import { logger } from "@/utils/logger";
import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
// Off TV the panel is presented over the app, so the screen owns its own backdrop and close.
const IS_PAD = !IS_TV && Platform.OS === "ios" && Platform.isPad;

type Busy = "record" | "series" | "cancel" | "cancelSeries" | null;

/**
 * One program of the guide: what it is, when it airs, and the recording it has or could have.
 * A root route like video-info: TV crossfades a card, phone presents a sheet. Watch replaces the
 * sheet with the player on phone, the same way video-info plays.
 *
 * Without a programId (a channel with no server guide data) the panel runs in channel mode:
 * the channel's name headlines and Record starts a manual timer for the settings length.
 */
export default function ProgramInfoScreen() {
  const params = useLocalSearchParams<{ programId?: string; channelId?: string; channelName?: string }>();
  const router = useRouter();
  const { showGlobalLoader } = useLoadingActions();
  const programId = params.programId || undefined;
  const [program, setProgram] = useState<JellyfinProgram | null>(null);
  const [timer, setTimer] = useState<JellyfinTimer | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
  const [nowMs] = useState(() => Date.now());
  const canManage = useLiveTvManagement();

  const channelId = params.channelId || program?.ChannelId;
  const channelName = cleanLabel(params.channelName || program?.ChannelName);

  const loadTimer = useCallback(async () => {
    const timers = await fetchTimers();
    setTimer(activeRecordTimer(timers, { programId, channelId: params.channelId ?? "" }, Date.now()));
  }, [programId, params.channelId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [fetched] = await Promise.all([programId ? fetchProgram(programId) : null, loadTimer()]);
        if (!cancelled && fetched) setProgram(fetched);
      } catch (err) {
        logger.error("Program load failed", err, { screen: "ProgramInfo", programId });
        if (!cancelled) setFailed(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [programId, loadTimer]);

  const run = useCallback(
    async (kind: Exclude<Busy, null>, action: () => Promise<void>, doneToast: string) => {
      setBusy(kind);
      try {
        await action();
        await loadTimer();
        showToast(doneToast);
      } catch (err) {
        logger.error("Recording action failed", err, { screen: "ProgramInfo", kind });
        showToast(t("liveTv.recordingFailed"), "error");
      } finally {
        setBusy(null);
      }
    },
    [loadTimer],
  );
  const handleRecord = useCallback(() => {
    // A program records to its end; a channel without one gets a manual timer for the
    // settings length. The toast names the running length; a future program is scheduled.
    if (programId) {
      const remainingMs = program && isAiring(program, Date.now()) ? programTimes(program).endMs - Date.now() : 0;
      const doneToast = remainingMs > 0 ? t("liveTv.recordingStartedFor").replace("{duration}", durationLabel(remainingMs)) : t("liveTv.recordingScheduled");
      return run("record", async () => createTimer(await fetchTimerDefaults(programId)), doneToast);
    }
    if (!channelId) return;
    const recordingMs = getLiveTvPreferences().recordingMinutes * 60_000;
    // The timer's name becomes the recording folder; a leading dot would hide it from the
    // server's scanner (Jellyfin ignores "**/.*").
    const timerName = channelName.replace(/^[.\s]+/, "") || channelId;
    return run(
      "record",
      async () => {
        const defaults = await fetchTimerDefaults();
        await createTimer({ ...defaults, ChannelId: channelId, Name: timerName, StartDate: new Date().toISOString(), EndDate: new Date(Date.now() + recordingMs).toISOString() });
      },
      t("liveTv.recordingStartedFor").replace("{duration}", durationLabel(recordingMs)),
    );
  }, [run, programId, program, channelId, channelName]);
  const handleRecordSeries = useCallback(() => run("series", async () => createSeriesTimer(await fetchTimerDefaults(programId)), t("liveTv.recordingScheduled")), [run, programId]);
  const handleCancel = useCallback(
    () => run("cancel", async () => (timer ? cancelTimer(timer.Id) : undefined), t(timer?.Status === "InProgress" ? "liveTv.recordingStopped" : "liveTv.recordingCanceled")),
    [run, timer],
  );
  const handleCancelSeries = useCallback(
    () => run("cancelSeries", async () => (timer?.SeriesTimerId ? cancelSeriesTimer(timer.SeriesTimerId) : undefined), t("liveTv.recordingCanceled")),
    [run, timer],
  );
  const handleWatch = useCallback(() => {
    if (!channelId) return;
    showGlobalLoader();
    const destination = { pathname: "/player" as const, params: { videoId: channelId, videoName: channelName, live: "1" } };
    if (IS_TV) router.push(destination);
    else router.replace(destination);
  }, [channelId, channelName, router, showGlobalLoader]);

  const airing = program ? isAiring(program, nowMs) : false;
  const { startMs, endMs } = program ? programTimes(program) : { startMs: 0, endMs: 0 };
  const when = program ? `${formatDayLabel(startMs, nowMs, { today: t("liveTv.today"), tomorrow: t("liveTv.tomorrow") })} ${formatClock(startMs)} to ${formatClock(endMs)}` : "";
  const category = program ? programCategory(program) : null;
  const inSeries = !!timer?.SeriesTimerId;
  const recordingNow = timer?.Status === "InProgress";
  // Channel mode plays now, so Watch leads; with a program only its airing does.
  const watchable = !!channelId && (airing || !programId);

  const content = failed ? (
    <View style={styles.status}>
      <Ionicons name="alert-circle-outline" size={64} color={COLORS.DESTRUCTIVE} />
      <Text style={styles.statusText}>{failed}</Text>
      <FocusableButton title={t("common.goBack")} variant="secondary" hasTVPreferredFocus onPress={() => router.back()} style={styles.button} />
    </View>
  ) : programId && !program ? (
    <View style={styles.status}>
      <LoadingRow label={t("liveTv.guide")} />
    </View>
  ) : (
    <>
      <View style={styles.headline}>
        {program?.Id && hasPoster(program) ? (
          <Image
            source={serverPoster(program.Id, program.ImageTags?.Primary, IS_TV ? 600 : 300)}
            style={[styles.poster, { aspectRatio: program.PrimaryImageAspectRatio || 2 / 3 }]}
            contentFit="cover"
            transition={200}
            accessible
            accessibilityLabel={t("a11y.poster").replace("{name}", cleanLabel(program.Name))}
          />
        ) : null}
        <View style={styles.headlineText}>
          <Text style={styles.title}>{program ? cleanLabel(program.Name) : channelName}</Text>
          {program?.EpisodeTitle ? <Text style={styles.episode}>{cleanLabel(program.EpisodeTitle)}</Text> : null}
          {program ? <Text style={styles.meta}>{[channelName, when].filter(Boolean).join("  ·  ")}</Text> : null}
          {category || program?.IsRepeat || timer ? (
            <View style={styles.tags}>
              {category ? <Text style={styles.tag}>{category}</Text> : null}
              {timer ? (
                <View style={styles.recordingTag}>
                  <View style={styles.recordingDot} />
                  <Text style={styles.recordingTagText}>{recordingNow ? t("liveTv.recordingNow") : inSeries ? t("liveTv.seriesRules") : t("liveTv.record")}</Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>
      {program?.Overview ? <Text style={styles.overview}>{program.Overview}</Text> : null}
      <View style={styles.buttons}>
        {watchable ? (
          <FocusableButton
            title={t("liveTv.watch")}
            variant="primary"
            hasTVPreferredFocus
            icon={<Ionicons name="play" size={IS_TV ? 30 : 20} color={COLORS.ON_ACCENT} />}
            onPress={handleWatch}
            style={styles.button}
          />
        ) : null}
        {!canManage ? null : timer ? (
          <FocusableButton
            title={recordingNow ? t("liveTv.stopRecording") : t("liveTv.cancelRecording")}
            variant="secondary"
            hasTVPreferredFocus={!watchable}
            isLoading={busy === "cancel"}
            disabled={busy !== null}
            icon={<Ionicons name={recordingNow ? "stop-circle-outline" : "close-circle-outline"} size={IS_TV ? 30 : 20} color={COLORS.ACCENT} />}
            onPress={handleCancel}
            style={styles.button}
          />
        ) : (
          <FocusableButton
            title={t("liveTv.record")}
            variant={watchable ? "secondary" : "primary"}
            hasTVPreferredFocus={!watchable}
            isLoading={busy === "record"}
            disabled={busy !== null}
            icon={<Ionicons name="radio-button-on" size={IS_TV ? 30 : 20} color={watchable ? COLORS.ACCENT : COLORS.ON_ACCENT} />}
            onPress={handleRecord}
            style={styles.button}
          />
        )}
        {canManage && program?.IsSeries ? (
          inSeries ? (
            <FocusableButton
              title={t("liveTv.cancelSeries")}
              variant="secondary"
              isLoading={busy === "cancelSeries"}
              disabled={busy !== null}
              icon={<Ionicons name="repeat" size={IS_TV ? 30 : 20} color={COLORS.ACCENT} />}
              onPress={handleCancelSeries}
              style={styles.button}
            />
          ) : (
            <FocusableButton
              title={t("liveTv.recordSeries")}
              variant="secondary"
              isLoading={busy === "series"}
              disabled={busy !== null}
              icon={<Ionicons name="repeat" size={IS_TV ? 30 : 20} color={COLORS.ACCENT} />}
              onPress={handleRecordSeries}
              style={styles.button}
            />
          )
        ) : null}
      </View>
    </>
  );

  if (IS_TV) {
    return (
      <View style={styles.tvRoot}>
        <AmbientBackground />
        <GlassSurface style={styles.tvCard} radius={DESIGN.BORDER_RADIUS_CARD}>
          <View style={styles.tvCardInner}>{content}</View>
        </GlassSurface>
      </View>
    );
  }
  return (
    <PadSheet onClose={() => router.back()} closeHint={t("info.closeHint")} fit={IS_PAD ? "center" : "bottom"}>
      <ScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetContent}>
        {content}
      </ScrollView>
    </PadSheet>
  );
}

const styles = StyleSheet.create({
  tvRoot: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  tvCard: {
    width: 1100,
    maxWidth: "86%",
  },
  tvCardInner: {
    padding: 56,
    gap: 14,
  },
  // flexGrow 0 lets the card shrink to its content, scrolling only past the sheet's max height.
  sheetScroll: {
    flexGrow: 0,
  },
  sheetContent: {
    padding: 24,
    gap: 10,
  },

  status: {
    alignItems: "center",
    justifyContent: "center",
    padding: 40,
    gap: 18,
  },
  statusText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 22 : 16,
    textAlign: "center",
  },
  headline: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: IS_TV ? 36 : 16,
  },
  // Off TV the right margin clears the card's floating close (12 + 44 from the edge).
  headlineText: {
    flex: 1,
    gap: IS_TV ? 14 : 10,
    marginRight: IS_TV ? 0 : 36,
  },
  poster: {
    width: IS_TV ? 260 : 110,
    borderRadius: DESIGN.BORDER_RADIUS_MEDIUM,
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  title: {
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 44 : 26,
    fontWeight: "800",
  },
  episode: {
    color: COLORS.TEXT_BRIGHT,
    fontSize: IS_TV ? 28 : 18,
    fontWeight: "600",
  },
  meta: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 24 : 15,
  },
  tags: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 14 : 8,
    marginTop: IS_TV ? 6 : 2,
  },
  tag: {
    color: COLORS.ACCENT,
    fontSize: IS_TV ? 20 : 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  recordingTag: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 8 : 5,
  },
  recordingDot: {
    width: IS_TV ? 12 : 8,
    height: IS_TV ? 12 : 8,
    borderRadius: DESIGN.BORDER_RADIUS_ROUND,
    backgroundColor: COLORS.DESTRUCTIVE,
  },
  recordingTagText: {
    color: COLORS.DESTRUCTIVE_SOFT,
    fontSize: IS_TV ? 20 : 13,
    fontWeight: "700",
  },
  overview: {
    color: COLORS.TEXT_BODY,
    fontSize: IS_TV ? 24 : 16,
    lineHeight: IS_TV ? 34 : 23,
    marginTop: IS_TV ? 10 : 6,
  },
  buttons: {
    marginTop: IS_TV ? 30 : 20,
    gap: IS_TV ? 16 : 12,
    alignItems: "flex-start",
  },
  // One width for the whole stack: hierarchy is fill against outline, never size.
  button: {
    width: IS_TV ? 520 : "100%",
    minWidth: 0,
  },
});
