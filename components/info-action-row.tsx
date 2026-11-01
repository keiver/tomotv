import { FocusableButton } from "@/components/FocusableButton";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const CIRCLE = IS_TV ? 104 : 66;
const SLOT = CIRCLE + (IS_TV ? 24 : 10);
const ICON = IS_TV ? 46 : 28;
/** The height the icon takes in the stack; a taller icon grows upward, so the word stays put. */
const ICON_BOX = IS_TV ? 32 : 22;
const LABEL = IS_TV ? 19 : 11;
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
  /** One word inside the circle. */
  word: string;
  destructive?: boolean;
  onPress: () => void;
}

export type DownloadCircleState = "none" | "queued" | "downloading" | "paused" | "ready" | "failed";

interface ToggleCircle {
  key: "favorite" | "watched" | "progress";
  icon: keyof typeof Ionicons.glyphMap;
  offIcon: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  word: string;
  accessibilityLabel: string;
  /** The write the press makes; `done` is what the caption reports when it lands. */
  run: () => boolean | Promise<boolean>;
  done: string;
}

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
 * The panel's secondary controls: one circle per control, toggles first, each holding its
 * icon and word, and a caption under the row.
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
  const { accent, onAccent } = useCardPalette();
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

  const labeled = (name: keyof typeof Ionicons.glyphMap, ink: string, word: string) => (
    <View style={styles.content}>
      <Ionicons name={name} size={ICON} color={ink} style={styles.icon} />
      <Text style={[styles.label, { color: ink }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {word}
      </Text>
    </View>
  );

  const toggles: ToggleCircle[] = [
    ...(onToggleFavorite
      ? [
          {
            key: "favorite" as const,
            icon: "heart" as const,
            offIcon: "heart-outline" as const,
            selected: isFavorite,
            word: t("info.word.favorite"),
            accessibilityLabel: favoriteLabel,
            run: onToggleFavorite,
            done: isFavorite ? t("info.removedFavorite") : t("info.addedFavorite"),
          },
        ]
      : []),
    ...(onToggleWatched
      ? [
          {
            key: "watched" as const,
            icon: "eye" as const,
            offIcon: "eye-off" as const,
            selected: isPlayed,
            word: t("info.word.watched"),
            accessibilityLabel: watchedLabel,
            run: onToggleWatched,
            done: isPlayed ? t("info.markedUnwatched") : t("info.markedWatched"),
          },
        ]
      : []),
    // On while the position stands; a cleared one is off until restored.
    ...(onToggleProgress
      ? [
          {
            key: "progress" as const,
            icon: "bookmark" as const,
            offIcon: "bookmark-outline" as const,
            selected: !cleared,
            word: t("info.word.progress"),
            accessibilityLabel: progressLabel,
            run: onToggleProgress,
            done: cleared ? t("info.progressRestored") : t("info.progressCleared"),
          },
        ]
      : []),
  ];

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {toggles.map((toggle) => (
          <View key={toggle.key} style={styles.slot}>
            <FocusableButton
              variant={toggle.selected ? "primary" : "secondary"}
              style={styles.circle}
              icon={labeled(toggle.selected ? toggle.icon : toggle.offIcon, toggle.selected ? onAccent : accent, toggle.word)}
              accessibilityLabel={toggle.accessibilityLabel}
              accessibilityState={{ selected: toggle.selected }}
              onFocus={() => setFocused(toggle.key)}
              onBlur={() => blur(toggle.key)}
              onPress={press(toggle.run, toggle.done)}
            />
          </View>
        ))}
        {(!!onStopRecording || stopSpent) && (
          // Always lit and red: one irreversible press, never a toggle. A bare glyph, since the
          // button is the circle (see the download arrow).
          <View style={styles.slot}>
            <FocusableButton
              variant="secondary"
              style={styles.circle}
              icon={labeled("stop", COLORS.DESTRUCTIVE, t("info.word.stop"))}
              accessibilityLabel={t("liveTv.stopRecording")}
              accessibilityState={{ disabled: stopSpent }}
              onFocus={() => setFocused("stop")}
              onBlur={() => blur("stop")}
              onPress={onStopRecording ? press(onStopRecording, t("liveTv.recordingStopped")) : undefined}
            />
          </View>
        )}
        {!!onToggleDownload && !!downloadState && (
          // Always lit: this is an action, not a toggle. Every state it renders in is a press
          // worth making, "none" most of all. Failure takes the ink; the caption carries state.
          <View style={styles.slot}>
            <FocusableButton
              variant="secondary"
              style={styles.circle}
              icon={labeled("arrow-down", downloadState === "failed" ? COLORS.DESTRUCTIVE : accent, t("info.word.download"))}
              accessibilityLabel={download.label}
              accessibilityState={{ selected: downloadState === "ready" }}
              onFocus={() => setFocused("download")}
              onBlur={() => blur("download")}
              onPress={press(onToggleDownload, download.done)}
            />
          </View>
        )}
        {extras.map((extra) => {
          const key = `extra:${extra.key}` as const;
          return (
            <View key={extra.key} style={styles.slot}>
              <FocusableButton
                variant="secondary"
                style={styles.circle}
                icon={labeled(extra.icon, extra.destructive ? COLORS.DESTRUCTIVE : accent, extra.word)}
                accessibilityLabel={extra.label}
                onFocus={() => setFocused(key)}
                onBlur={() => blur(key)}
                onPress={extra.onPress}
              />
            </View>
          );
        })}
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
  // Touch: four 76pt slots make 304, inside a 375pt iPhone's 319 of card; a fifth wraps.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  slot: {
    width: SLOT,
    alignItems: "center",
  },
  // Shape and no border: fill and focus come from the primary and secondary variants, as on the
  // panel's two pills. minHeight has to be restated or styles.button's CONTROL_HEIGHT floor wins.
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    minWidth: 0,
    minHeight: CIRCLE,
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderWidth: 0,
  },
  content: {
    alignItems: "center",
    justifyContent: "center",
    gap: IS_TV ? 4 : 1,
  },
  icon: {
    marginTop: ICON_BOX - ICON,
  },
  label: {
    fontSize: LABEL,
    fontWeight: "600",
    maxWidth: CIRCLE - (IS_TV ? 16 : 14),
    textAlign: "center",
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
