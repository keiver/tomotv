import { GlassButton } from "@/components/glass-button";
import { GLASS_CIRCLE, GLASS_SLOT, GlassToggleGroup, GlassWord, type GlassToggle } from "@/components/glass-toggle-group";
import { COLORS } from "@/constants/colors";
import { themedStyles, useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { withAlpha } from "@/utils/color";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const ICON = IS_TV ? 30 : 20;
/** How long an action report holds the caption before focus takes it back. */
const MESSAGE_MS = 2200;

interface InfoActionRowProps {
  isFavorite?: boolean;
  isPlayed?: boolean;
  /** Progress was cleared while this panel has been open, so the snapshot is still restorable. */
  cleared?: boolean;
  /** Resolve false when the write did not land, so the caption reports what happened. Omit where no favorite is readable. */
  onToggleFavorite?: () => Promise<boolean>;
  /** Omit where an item has no watched state (live channels); the circle goes with it. */
  onToggleWatched?: () => Promise<boolean>;
  /** Omit when the item has nothing to clear, the third circle disappears with it. */
  onToggleProgress?: () => boolean;
  /** Omit where a download cannot exist (Apple TV, containers, photos); the circle goes with it. */
  downloadState?: DownloadCircleState;
  /** Queues the item if it is not held yet; a held item stays put and reports itself. */
  onToggleDownload?: () => Promise<boolean>;
  /** Omit unless an in-progress recording can be stopped; the write deletes its timer. */
  onStopRecording?: () => Promise<boolean>;
  /** Actions past the panel's two CTAs, after the toggles. Each confirms or navigates on its own. */
  extras?: InfoExtraAction[];
}

export interface InfoExtraAction {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** One word under the circle. */
  word: string;
  destructive?: boolean;
  onPress: () => void;
}

export type DownloadCircleState = "none" | "queued" | "downloading" | "paused" | "ready" | "failed";

/**
 * Per state: the press it names and what the caption reports afterwards. An empty report is a
 * press that leaves for the Downloads tab; a held item goes nowhere and says so.
 *
 * One bare arrow throughout, always lit: the button is the circle, so a ringed glyph draws a
 * ring inside a ring, and a dim rest state would read as unavailable on an action that is not
 * a toggle. State lives in the caption.
 */
const downloadCopy = (): Record<DownloadCircleState, { label: string; done: string }> => ({
  none: { label: t("info.download"), done: "" },
  queued: { label: t("info.showInDownloads"), done: "" },
  downloading: { label: t("info.showInDownloads"), done: "" },
  paused: { label: t("info.showInDownloads"), done: "" },
  ready: { label: t("info.downloaded"), done: t("info.savedOffline") },
  failed: { label: t("info.retryDownload"), done: "" },
});

/**
 * The panel's secondary controls: the toggles in one glass capsule, then the actions as separate
 * circles, each with one word under it, and a caption under the row.
 *
 * On tvOS the caption names what the focused control's next press will do; on both platforms a
 * press replaces it with what just happened.
 */
type ActionKey = "favorite" | "watched" | "progress" | "download" | "stop" | `extra:${string}`;

export function InfoActionRow({
  isFavorite = false,
  isPlayed = false,
  cleared = false,
  onToggleFavorite,
  onToggleWatched,
  onToggleProgress,
  downloadState,
  onToggleDownload,
  onStopRecording,
  extras = [],
}: InfoActionRowProps) {
  // Which circle holds focus, never the label itself: tvOS fires the outgoing blur AFTER the
  // incoming focus, so a shared string gets wiped by the button focus just left.
  const [focused, setFocused] = useState<ActionKey | null>(null);
  const { accent } = useCardPalette();
  const themed = useThemedStyles();
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => (messageTimer.current ? clearTimeout(messageTimer.current) : undefined), []);

  const report = useCallback((text: string, failed = false) => {
    setMessage({ text, failed });
    // The caption is hidden from assistive tech, so the report has to be spoken: a screen
    // reader stays on the button it just pressed and would never reach the text.
    AccessibilityInfo.announceForAccessibility(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), MESSAGE_MS);
  }, []);

  const blur = useCallback((key: ActionKey) => setFocused((current) => (current === key ? null : current)), []);
  // A stopped recording's circle stays, spent, until focus leaves it: unmounting the focused view
  // would throw tvOS focus off the row.
  const stopSpent = !onStopRecording && focused === "stop";

  // Labels state the press, not the noun, so the caption reads the same way the row acts.
  const favoriteLabel = isFavorite ? t("info.removeFavorite") : t("info.addFavorite");
  const watchedLabel = isPlayed ? t("info.markUnwatched") : t("info.markWatched");
  const progressLabel = cleared ? t("info.restoreProgress") : t("info.clearProgress");
  const download = downloadCopy()[downloadState ?? "none"];
  const focusLabel =
    focused === "favorite"
      ? favoriteLabel
      : focused === "watched"
        ? watchedLabel
        : focused === "progress"
          ? progressLabel
          : focused === "download"
            ? download.label
            : focused === "stop"
              ? stopSpent
                ? ""
                : t("liveTv.stopRecording")
              : (extras.find((extra) => focused === `extra:${extra.key}`)?.label ?? "");

  // Awaited: reporting before the write lands claims a success the server can still refuse,
  // and a glyph this small cannot contradict the caption afterwards.
  const press = (run: () => boolean | Promise<boolean>, done: string) => async () => {
    const ok = await run();
    // An empty `done` is an action that navigates: the caption would be reporting to a screen
    // that is already leaving.
    if (ok && !done) return;
    // One line for every write the server refused; the glyph has already rolled back.
    report(ok ? done : t("info.couldNotReachServer"), !ok);
  };

  // Focus outranks rest: a custom style is flattened AFTER the focused variant style, so this
  // layer is the one that lands.
  const circleStyle = (key: ActionKey) => StyleSheet.flatten([styles.circle, focused === key ? themed.circleFocused : themed.circleOn]);
  const iconColor = (key: ActionKey, rest: string = accent) => (focused === key ? COLORS.TEXT_PRIMARY : rest);

  const toggles: GlassToggle[] = [
    ...(onToggleFavorite
      ? [
          {
            key: "favorite",
            icon: "heart" as const,
            offIcon: "heart-outline" as const,
            selected: isFavorite,
            focused: focused === "favorite",
            word: t("info.word.favorite"),
            accessibilityLabel: favoriteLabel,
            onPress: () => void press(onToggleFavorite, isFavorite ? t("info.removedFavorite") : t("info.addedFavorite"))(),
            onFocus: () => setFocused("favorite"),
            onBlur: () => blur("favorite"),
          },
        ]
      : []),
    ...(onToggleWatched
      ? [
          {
            key: "watched",
            icon: "eye" as const,
            offIcon: "eye-off" as const,
            selected: isPlayed,
            focused: focused === "watched",
            word: t("info.word.watched"),
            accessibilityLabel: watchedLabel,
            onPress: () => void press(onToggleWatched, isPlayed ? t("info.markedUnwatched") : t("info.markedWatched"))(),
            onFocus: () => setFocused("watched"),
            onBlur: () => blur("watched"),
          },
        ]
      : []),
    // On while the position stands; a cleared one is off until restored.
    ...(onToggleProgress
      ? [
          {
            key: "progress",
            icon: "bookmark" as const,
            offIcon: "bookmark-outline" as const,
            selected: !cleared,
            focused: focused === "progress",
            word: t("info.word.progress"),
            accessibilityLabel: progressLabel,
            onPress: () => void press(onToggleProgress, cleared ? t("info.progressRestored") : t("info.progressCleared"))(),
            onFocus: () => setFocused("progress"),
            onBlur: () => blur("progress"),
          },
        ]
      : []),
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {(!!onToggleFavorite || !!onToggleWatched || !!onToggleProgress) && <GlassToggleGroup toggles={toggles} />}
        <View style={styles.actions}>
          {(!!onStopRecording || stopSpent) && (
            // Always lit and red: one irreversible press, never a toggle. A bare glyph, since the
            // button is the circle (see the download arrow).
            <View style={styles.slot}>
              <GlassButton
                variant="link"
                style={circleStyle("stop")}
                icon={<Ionicons name="stop" size={ICON} color={iconColor("stop", COLORS.DESTRUCTIVE)} />}
                accessibilityLabel={t("liveTv.stopRecording")}
                accessibilityState={{ disabled: stopSpent }}
                onFocus={() => setFocused("stop")}
                onBlur={() => blur("stop")}
                onPress={onStopRecording ? press(onStopRecording, t("liveTv.recordingStopped")) : undefined}
              />
              <GlassWord>{t("info.word.stop")}</GlassWord>
            </View>
          )}
          {!!onToggleDownload && !!downloadState && (
            // Always lit: this is an action, not a toggle. Every state it renders in is a press
            // worth making, "none" most of all. Failure takes the ink; the caption carries state.
            <View style={styles.slot}>
              <GlassButton
                variant="link"
                style={circleStyle("download")}
                icon={<Ionicons name="arrow-down" size={ICON} color={iconColor("download", downloadState === "failed" ? COLORS.DESTRUCTIVE : accent)} />}
                accessibilityLabel={download.label}
                accessibilityState={{ selected: downloadState === "ready" }}
                onFocus={() => setFocused("download")}
                onBlur={() => blur("download")}
                onPress={press(onToggleDownload, download.done)}
              />
              <GlassWord>{t("info.word.download")}</GlassWord>
            </View>
          )}
          {extras.map((extra) => {
            const key = `extra:${extra.key}` as const;
            return (
              <View key={extra.key} style={styles.slot}>
                <GlassButton
                  variant="link"
                  style={circleStyle(key)}
                  icon={<Ionicons name={extra.icon} size={ICON} color={iconColor(key, extra.destructive ? COLORS.DESTRUCTIVE : accent)} />}
                  accessibilityLabel={extra.label}
                  onFocus={() => setFocused(key)}
                  onBlur={() => blur(key)}
                  onPress={extra.onPress}
                />
                <GlassWord>{extra.word}</GlassWord>
              </View>
            );
          })}
        </View>
      </View>
      {/* Height is reserved, so the panel never reflows as focus enters and leaves the row. */}
      <Text
        style={[styles.caption, message && (message.failed ? styles.captionFailed : styles.captionStatus)]}
        numberOfLines={1}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants">
        {message?.text || focusLabel}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Capped at the panel's width, so circles past it wrap to a centred second line instead of
  // hanging off both sides (iPhone Duo's closed screen, beside its side column).
  wrap: {
    alignSelf: "center",
    alignItems: "center",
    maxWidth: "100%",
  },
  // Touch: five 60pt slots and the 12pt gap between toggles and actions make 312, inside a 375pt iPhone's 319 of card.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: IS_TV ? 30 : 12,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  slot: {
    width: GLASS_SLOT,
    alignItems: "center",
  },
  // Sizing only: a custom style is flattened AFTER the focused variant style, so a colour
  // here would eat the focus ring. Square, which the base radius rounds to a circle;
  // minHeight has to be restated or styles.button's CONTROL_HEIGHT floor wins.
  circle: {
    width: GLASS_CIRCLE,
    height: GLASS_CIRCLE,
    minWidth: 0,
    minHeight: GLASS_CIRCLE,
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  caption: {
    height: IS_TV ? 30 : 20,
    lineHeight: IS_TV ? 30 : 20,
    marginTop: IS_TV ? 10 : 6,
    fontSize: IS_TV ? 20 : 13,
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
  // A report of something that just happened, not the name of what focus is on.
  captionStatus: {
    color: COLORS.SUCCESS,
  },
  captionFailed: {
    color: COLORS.DESTRUCTIVE,
  },
});

const useThemedStyles = themedStyles((palette) => ({
  // At rest: a wash well under the focus tint's 0.35, so the two never read alike.
  circleOn: {
    backgroundColor: withAlpha(palette.accent, 0.07),
  },
  // An accent wash the glass keeps refracting through, well above the on state's 0.07; the white
  // glyph is what separates focus from on.
  circleFocused: {
    backgroundColor: withAlpha(palette.accent, 0.35),
    borderColor: "transparent",
    shadowColor: palette.accent,
  },
}));
