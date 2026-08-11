import { settingsStyles } from "@/components/settings/styles";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

type IoniconName = keyof typeof Ionicons.glyphMap;

const IS_TV = Platform.isTV;

interface HelpRowProps {
  icon: IoniconName;
  title: string;
  /** Second line — a destination URL, or the value an informational row states. */
  subtitle?: string;
  /** Omit for an informational row: it still takes focus, it just has nowhere to go. */
  onPress?: () => void;
  /** Trailing mark. "none" is correct for a row that only states a value. */
  accessory?: "chevron" | "external" | "none";
  /**
   * Set on a row that opens an answer beneath itself. Swaps the trailing mark for
   * a disclosure chevron and reports the state to VoiceOver, which is the only
   * way a screen-reader user learns the row does anything at all.
   */
  expanded?: boolean;
  isFirst?: boolean;
  isLast?: boolean;
  hasTVPreferredFocus?: boolean;
}

const ACCESSORY_ICONS = {
  chevron: "chevron-forward",
  external: "open-outline",
} as const;

/**
 * HelpRow — a row in one of the Help tab's grouped sections.
 *
 * Same recipe as ServerRow (leading glyph, flexible label column, trailing
 * mark, parallax off so the columns can't drift on focus) but without that
 * component's server-specific variants. It sits inside `settingsStyles.section`,
 * which paints the sunken surface; the row itself stays transparent so the
 * card's inset shadow shows through, and nothing is ever layered above it — on
 * tvOS a view covering a focusable occludes it and the focus engine refuses to
 * enter.
 *
 * Rows with no `onPress` are still focusable. That is deliberate on tvOS: a
 * column of unfocusable text is a column the remote skips over and cannot
 * scroll, so an informational row takes focus the same way the license
 * paragraphs on the Acknowledgements screen do.
 */
export function HelpRow({ icon, title, subtitle, onPress, accessory = "chevron", expanded, isFirst = false, isLast = false, hasTVPreferredFocus = false }: HelpRowProps) {
  // A disclosure row owns its own mark, pointing the way the answer will move.
  const mark = expanded === undefined ? (accessory === "none" ? null : ACCESSORY_ICONS[accessory]) : expanded ? "chevron-up" : "chevron-down";

  return (
    <Pressable
      onPress={onPress}
      isTVSelectable={true}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      accessibilityHint={expanded === undefined ? undefined : expanded ? "Hides the answer" : "Shows the answer"}
      // No magnification: a scaled row drifts its glyph and trailing mark out of
      // column with its neighbours. The background tint carries focus.
      tvParallaxProperties={{ enabled: false }}
      style={({ focused }) => [settingsStyles.listItem, isFirst && settingsStyles.listItemFirst, isLast && settingsStyles.listItemLast, focused && styles.rowFocused]}>
      <View style={settingsStyles.listItemContent}>
        <View style={styles.left}>
          <Ionicons name={icon} size={IS_TV ? 32 : 22} color="#FFC312" />
          <View style={styles.labels}>
            <Text style={settingsStyles.listItemTitle} numberOfLines={1}>
              {title}
            </Text>
            {subtitle ? (
              <Text style={[settingsStyles.listItemSubtitle, styles.subtitle]} numberOfLines={1}>
                {subtitle}
              </Text>
            ) : null}
          </View>
        </View>
        {mark === null ? null : <Ionicons name={mark} size={IS_TV ? 28 : 20} color="#8E8E93" />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  left: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    gap: IS_TV ? 16 : 12,
  },
  labels: {
    flex: 1,
  },
  // The shared subtitle sits almost at title size, which reads as two competing
  // lines when stacked. Drop it a step, same as ServerRow.
  subtitle: {
    fontSize: IS_TV ? 22 : 14,
    marginTop: IS_TV ? 4 : 1,
  },
  rowFocused: {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
});
