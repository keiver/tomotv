import { BUTTON_BORDER_WIDTH, FocusableButton } from "@/components/FocusableButton";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { t } from "@/services/i18n";
import { withAlpha } from "@/utils/color";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const CIRCLE = IS_TV ? 104 : 66;
const SLOT = CIRCLE + (IS_TV ? 24 : 10);
const ICON = IS_TV ? 46 : 28;
const LABEL = IS_TV ? 19 : 11;
const REST_FILL = withAlpha(COLORS.TEXT_PRIMARY, 0.14);
/** Extra space between the toggles and the actions after them. */
const GROUP_GAP = IS_TV ? 40 : 14;
/** The smallest circle the phone row narrows to; past it the row wraps. */
const MIN_CIRCLE = 56;
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

/** Slot and circle sizes that put every circle on one line of `width`, or the full sizes when they would fall under MIN_CIRCLE. */
export function fittedSlot(width: number, count: number): { slot: number; circle: number } {
  const slot = count > 0 && width > 0 ? Math.min(SLOT, Math.floor(width / count)) : SLOT;
  if (slot === SLOT || slot - 4 < MIN_CIRCLE) return { slot: SLOT, circle: CIRCLE };
  return { slot, circle: slot - 4 };
}

export type DownloadCircleState = "none" | "queued" | "downloading" | "paused" | "ready" | "failed";

interface ToggleCircle {
  key: "favorite" | "watched" | "progress";
  /** SF Symbol names: Ionicons has no slashed bookmark, so both states of every toggle come from one family. */
  icon: string;
  offIcon: string;
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
 * icon with its word underneath, and a caption under the row. Only the focused circle is filled.
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
  const [rowWidth, setRowWidth] = useState(0);
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

  const glyph = (key: ActionKey, name: keyof typeof Ionicons.glyphMap, ink: string, alarm = false) => (
    <Ionicons name={name} size={ICON} color={focused === key ? (alarm ? COLORS.TEXT_PRIMARY : onAccent) : ink} />
  );
  const symbol = (key: ActionKey, name: string) => <SfSymbolIcon name={name} size={ICON} color={focused === key ? onAccent : accent} />;
  const circleFor = (key: ActionKey, alarm = false) => ({ ...circleStyle, backgroundColor: focused === key ? (alarm ? COLORS.DESTRUCTIVE : accent) : REST_FILL });
  // Actions carry the pill CTA's border; toggles never do.
  const actionFor = (key: ActionKey, alarm = false) => ({ ...circleFor(key, alarm), borderWidth: BUTTON_BORDER_WIDTH, borderColor: alarm ? COLORS.DESTRUCTIVE : accent });
  const wordFor = (key: ActionKey, word: string) => (
    <Text style={[styles.label, { maxWidth: fitted.slot - 4 }, focused === key && styles.labelFocused]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
      {word}
    </Text>
  );

  const toggles: ToggleCircle[] = [
    ...(onToggleFavorite
      ? [
          {
            key: "favorite" as const,
            icon: "heart.fill",
            offIcon: "heart.slash",
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
            icon: "eye.fill",
            offIcon: "eye.slash",
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
            icon: "bookmark.fill",
            offIcon: "bookmark.slash",
            selected: !cleared,
            word: t("info.word.progress"),
            accessibilityLabel: progressLabel,
            run: onToggleProgress,
            done: cleared ? t("info.progressRestored") : t("info.progressCleared"),
          },
        ]
      : []),
  ];

  const count = toggles.length + (onStopRecording || stopSpent ? 1 : 0) + (onToggleDownload && downloadState ? 1 : 0) + extras.length;
  const firstAction: ActionKey | undefined =
    toggles.length === 0 ? undefined : onStopRecording || stopSpent ? "stop" : onToggleDownload && downloadState ? "download" : extras[0] && `extra:${extras[0].key}`;
  const gap = firstAction ? GROUP_GAP : 0;
  const fitted = IS_TV ? { slot: SLOT, circle: CIRCLE } : fittedSlot(rowWidth - gap, count);
  const slotStyle = [styles.slot, { width: fitted.slot }];
  const actionSlot = (key: ActionKey) => (key === firstAction ? [...slotStyle, { marginLeft: gap }] : slotStyle);
  const circleStyle = { ...styles.circle, width: fitted.circle, height: fitted.circle, minHeight: fitted.circle };

  return (
    <View style={styles.wrap} onLayout={IS_TV ? undefined : (event) => setRowWidth(event.nativeEvent.layout.width)}>
      <View style={styles.row}>
        {toggles.map((toggle) => (
          <View key={toggle.key} style={slotStyle}>
            <FocusableButton
              variant="secondary"
              style={circleFor(toggle.key)}
              icon={symbol(toggle.key, toggle.selected ? toggle.icon : toggle.offIcon)}
              accessibilityLabel={toggle.accessibilityLabel}
              accessibilityState={{ selected: toggle.selected }}
              onFocus={() => setFocused(toggle.key)}
              onBlur={() => blur(toggle.key)}
              onPress={press(toggle.run, toggle.done)}
            />
            {wordFor(toggle.key, toggle.word)}
          </View>
        ))}
        {(!!onStopRecording || stopSpent) && (
          // Always lit and red: one irreversible press, never a toggle. A bare glyph, since the
          // button is the circle (see the download arrow).
          <View style={actionSlot("stop")}>
            <FocusableButton
              variant="secondary"
              style={actionFor("stop", true)}
              icon={glyph("stop", "stop", COLORS.DESTRUCTIVE, true)}
              accessibilityLabel={t("liveTv.stopRecording")}
              accessibilityState={{ disabled: stopSpent }}
              onFocus={() => setFocused("stop")}
              onBlur={() => blur("stop")}
              onPress={onStopRecording ? press(onStopRecording, t("liveTv.recordingStopped")) : undefined}
            />
            {wordFor("stop", t("info.word.stop"))}
          </View>
        )}
        {!!onToggleDownload && !!downloadState && (
          // Always lit: this is an action, not a toggle. Every state it renders in is a press
          // worth making, "none" most of all. Failure takes the ink; the caption carries state.
          <View style={actionSlot("download")}>
            <FocusableButton
              variant="secondary"
              style={actionFor("download", downloadState === "failed")}
              icon={glyph("download", "arrow-down", downloadState === "failed" ? COLORS.DESTRUCTIVE : accent, downloadState === "failed")}
              accessibilityLabel={download.label}
              accessibilityState={{ selected: downloadState === "ready" }}
              onFocus={() => setFocused("download")}
              onBlur={() => blur("download")}
              onPress={press(onToggleDownload, download.done)}
            />
            {wordFor("download", t("info.word.download"))}
          </View>
        )}
        {extras.map((extra) => {
          const key = `extra:${extra.key}` as const;
          return (
            <View key={extra.key} style={actionSlot(key)}>
              <FocusableButton
                variant="secondary"
                style={actionFor(key, extra.destructive)}
                icon={glyph(key, extra.icon, extra.destructive ? COLORS.DESTRUCTIVE : accent, extra.destructive)}
                accessibilityLabel={extra.label}
                onFocus={() => setFocused(key)}
                onBlur={() => blur(key)}
                onPress={extra.onPress}
              />
              {wordFor(key, extra.word)}
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
  // hanging off both sides (iPhone Duo's closed screen, beside its side column). On touch it
  // spans that width, which the slots are fitted to.
  wrap: {
    alignSelf: IS_TV ? "center" : "stretch",
    alignItems: "center",
    maxWidth: "100%",
  },
  // Touch: five slots narrow to 63pt to share a 375pt iPhone's 319 of card.
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
  },
  slot: {
    width: SLOT,
    alignItems: "center",
  },
  // Shape and no border; the fill is set per focus. minHeight has to be restated or styles.button's CONTROL_HEIGHT floor wins.
  circle: {
    width: CIRCLE,
    height: CIRCLE,
    minWidth: 0,
    minHeight: CIRCLE,
    paddingVertical: 0,
    paddingHorizontal: 0,
    borderWidth: 0,
  },
  label: {
    marginTop: IS_TV ? 10 : 4,
    fontSize: LABEL,
    fontWeight: "600",
    color: COLORS.TEXT_SECONDARY,
    textAlign: "center",
  },
  labelFocused: {
    color: COLORS.TEXT_PRIMARY,
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
    color: COLORS.DESTRUCTIVE_SOFT,
  },
});
