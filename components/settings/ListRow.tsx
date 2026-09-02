import { glyphSize, LeadingTile, useTileSide } from "@/components/settings/LeadingTile";
import { IS_PAD, POSTER_MARK_SIDE, ROW_CONTENT_MIN_HEIGHT, settingsStyles } from "@/components/settings/styles";
import { CARD_FOCUS } from "@/constants/app";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import { forwardRef, ReactNode } from "react";
import { AccessibilityRole, AccessibilityState, ActivityIndicator, Platform, Pressable, StyleProp, StyleSheet, Text, TextStyle, View } from "react-native";

type IoniconName = keyof typeof Ionicons.glyphMap;

/** A drawn mark in place of a glyph; the row hands it the ink its focus state calls for, and it owns its own box. */
type LeadingMark = (ink: { color: string }) => ReactNode;

const IS_TV = Platform.isTV;
const TRAILING_SIZE = IS_TV ? 28 : 20;
/** Touch alone must not fill the row: a swipe starts as one, and the pan needs its 10px to claim it. */
const PRESS_DELAY = IS_TV ? undefined : 120;

interface ListRowProps {
  /** Leading glyph, or a function drawing one (QualityMark). Omit for text-only rows (Acknowledgements). */
  icon?: IoniconName | LeadingMark;
  title: string;
  /** Second line — a URL, a preset description, or the value an informational row states. */
  subtitle?: string;
  /** Lead-in on the subtitle in the row's accent ink (ServerRow's "New · "). */
  subtitleAccent?: string;
  /** Trailing mark, inked to match the fill. Omit for a row that only states a value. */
  trailingIcon?: IoniconName;
  /** Replaces the trailing mark with a spinner. Does not disable the row. */
  isLoading?: boolean;
  /** Wears the gold at rest (the quality list's current preset). Focus on it shows a step lighter. */
  selected?: boolean;
  /** Destructive rows ink their glyph and label red at rest (Sign Out). */
  tone?: "default" | "destructive";
  /** Omit for an informational row: it still takes focus, it just has nowhere to go. */
  onPress?: () => void;
  onLongPress?: () => void;
  /** A long press has no gesture for VoiceOver, so a row offering one names it here too. */
  accessibilityActions?: readonly Readonly<{ name: string; label?: string }>[];
  onAccessibilityAction?: (event: { nativeEvent: { actionName: string } }) => void;
  /**
   * tvOS focus arrival. Only used by rows at the ends of a capped, internally-scrolling list,
   * which pin the scroll offset so focus can leave it — see NotConnectedSection and the
   * quality list in app/(tabs)/settings.tsx.
   */
  onFocus?: () => void;
  disabled?: boolean;
  hasTVPreferredFocus?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  /** Per-surface metrics — the quality list pins its line heights for the section's height cap. */
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
  accessibilityRole?: AccessibilityRole;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  accessibilityState?: AccessibilityState;
}

/**
 * ListRow — the one row for a grouped, sunken settings-style section: leading
 * glyph, flexible label column, trailing mark. Focus (and `selected`) fills
 * the row with the action gold, a press deepens it; the state machine lives
 * here and nowhere else.
 *
 * It sits inside `settingsStyles.section`, which paints the sunken surface;
 * the row stays transparent at rest so the card's inset shadow shows through,
 * and nothing is ever layered above it — on tvOS a view covering a focusable
 * occludes it and the focus engine refuses to enter.
 *
 * Rows with no `onPress` are still focusable, with a neutral wash instead of
 * gold. Deliberate on tvOS: a column of unfocusable text is a column the
 * remote skips over and cannot scroll — and the gold fill is the app's "this
 * acts" mark, so a row that only takes focus to be readable must not wear it.
 *
 * No magnification: a scaled row drifts its glyph and trailing mark out of
 * column with its neighbours. The background fill carries focus.
 *
 * Forwards its ref to the Pressable so a host can requestTVFocus on a row.
 */
export const ListRow = forwardRef<View, ListRowProps>(function ListRow(
  {
    icon,
    title,
    subtitle,
    subtitleAccent,
    trailingIcon,
    isLoading = false,
    selected = false,
    tone = "default",
    onPress,
    onLongPress,
    accessibilityActions,
    onAccessibilityAction,
    onFocus,
    disabled = false,
    hasTVPreferredFocus = false,
    isFirst = false,
    isLast = false,
    titleStyle,
    subtitleStyle,
    accessibilityRole,
    accessibilityLabel,
    accessibilityHint,
    accessibilityState,
  }: ListRowProps,
  ref,
) {
  const actionable = Boolean(onPress);
  const [tileSide, onTileLayout] = useTileSide();
  const labelsBox = { minHeight: icon ? POSTER_MARK_SIDE : ROW_CONTENT_MIN_HEIGHT };

  return (
    <Pressable
      ref={ref}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityActions={accessibilityActions}
      onAccessibilityAction={onAccessibilityAction}
      onFocus={onFocus}
      disabled={disabled}
      isTVSelectable={!disabled}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole={accessibilityRole ?? (actionable ? "button" : "text")}
      accessibilityLabel={accessibilityLabel ?? (subtitle ? `${title}, ${subtitle}` : title)}
      accessibilityHint={accessibilityHint}
      accessibilityState={accessibilityState}
      tvParallaxProperties={{ enabled: false }}
      unstable_pressDelay={PRESS_DELAY}
      style={({ focused, pressed }) => {
        const gold = actionable && (focused || pressed || selected);
        return [
          settingsStyles.listItem,
          isFirst && settingsStyles.listItemFirst,
          isLast && settingsStyles.listItemLast,
          actionable && (focused || selected) && !pressed && settingsStyles.listItemFocused,
          actionable && focused && selected && !pressed && settingsStyles.listItemFocusedSelected,
          actionable && pressed && settingsStyles.listItemPressed,
          // A gold row covers the card's inset shadow; re-paint the parts it hides
          // (side rim always, plus the lip at whichever card edge it sits on).
          gold && (isFirst && isLast ? settingsStyles.rowShadowTopBottom : isFirst ? settingsStyles.rowShadowTop : isLast ? settingsStyles.rowShadowBottom : settingsStyles.rowShadowSides),
          !actionable && (focused || pressed) && styles.rowFocusedNeutral,
          disabled && styles.rowDisabled,
        ];
      }}>
      {({ focused, pressed }) => {
        // Every mark on the row is gold at rest; on the gold fill they all take the bar's ink.
        // Red only survives at rest: on the gold fill it sits at 2.2:1. The softer red is what
        // clears 4.5:1 against the card at this size.
        const onGold = actionable && (focused || pressed || selected);
        const restInk = tone === "destructive" ? COLORS.DESTRUCTIVE_SOFT : COLORS.ACCENT;
        const accentInk = onGold ? CARD_FOCUS.TITLE_TEXT_FOCUSED : restInk;
        const trailingInk = onGold ? CARD_FOCUS.TITLE_TEXT_FOCUSED : COLORS.TEXT_TERTIARY;
        return (
          <View style={settingsStyles.listItemContent}>
            <View style={styles.left}>
              {icon ? (
                <LeadingTile side={tileSide}>{typeof icon === "function" ? icon({ color: accentInk }) : <Ionicons name={icon} size={glyphSize(tileSide)} color={accentInk} />}</LeadingTile>
              ) : null}
              <View style={[styles.labels, labelsBox]} onLayout={icon ? onTileLayout : undefined}>
                <Text
                  style={[
                    settingsStyles.listItemTitle,
                    subtitle != null && settingsStyles.listItemTitleStacked,
                    titleStyle,
                    tone === "destructive" && !onGold && { color: COLORS.DESTRUCTIVE_SOFT },
                    onGold && settingsStyles.listItemTitleFocused,
                  ]}
                  numberOfLines={1}>
                  {title}
                </Text>
                {subtitle != null ? (
                  <Text style={[settingsStyles.listItemSubtitle, styles.subtitle, subtitleStyle, onGold && settingsStyles.listItemSubtitleFocused]} numberOfLines={1}>
                    {subtitleAccent ? <Text style={{ color: accentInk }}>{subtitleAccent}</Text> : null}
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
            {isLoading || trailingIcon ? (
              <View style={styles.trailing}>{isLoading ? <ActivityIndicator color={accentInk} size="small" /> : <Ionicons name={trailingIcon!} size={TRAILING_SIZE} color={trailingInk} />}</View>
            ) : null}
          </View>
        );
      }}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  left: {
    flexDirection: "row",
    alignItems: "flex-start",
    flex: 1,
    gap: IS_TV ? 16 : 12,
  },
  // A lone title centres against the tile; a stacked pair is as tall and sits at the top.
  labels: {
    flex: 1,
    justifyContent: "center",
  },
  // The shared listItemSubtitle sits almost at title size, which reads as two
  // competing lines when stacked. Drop it a step and give it room.
  subtitle: {
    fontSize: IS_TV ? 22 : IS_PAD ? 15 : 14,
    marginTop: IS_TV ? 4 : 1,
  },
  // The spinner box is narrower than the checkmark's, so the slot is fixed at the
  // mark's width and centres whichever it holds, on the row's full height.
  trailing: {
    width: TRAILING_SIZE,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
  },
  rowFocusedNeutral: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  rowDisabled: {
    opacity: 0.5,
  },
});
