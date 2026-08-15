import { settingsStyles } from "@/components/settings/styles";
import { CARD_FOCUS } from "@/constants/app";
import { Ionicons } from "@expo/vector-icons";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";

type IoniconName = keyof typeof Ionicons.glyphMap;

const IS_TV = Platform.isTV;

interface InfoRowProps {
  icon: IoniconName;
  title: string;
  /** Second line — a destination URL, or the value an informational row states. */
  subtitle?: string;
  /** Omit for an informational row: it still takes focus, it just has nowhere to go. */
  onPress?: () => void;
  /** Trailing mark. "none" is correct for a row that only states a value. */
  accessory?: "chevron" | "external" | "none";
  isFirst?: boolean;
  isLast?: boolean;
  hasTVPreferredFocus?: boolean;
}

const ACCESSORY_ICONS = {
  chevron: "chevron-forward",
  external: "open-outline",
} as const;

/**
 * InfoRow — a general-purpose row for a grouped Settings section.
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
export function InfoRow({ icon, title, subtitle, onPress, accessory = "chevron", isFirst = false, isLast = false, hasTVPreferredFocus = false }: InfoRowProps) {
  return (
    <Pressable
      onPress={onPress}
      isTVSelectable={true}
      hasTVPreferredFocus={hasTVPreferredFocus}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      // No magnification: a scaled row drifts its glyph and trailing mark out of
      // column with its neighbours. The background tint carries focus.
      tvParallaxProperties={{ enabled: false }}
      style={({ focused, pressed }) => [
        settingsStyles.listItem,
        isFirst && settingsStyles.listItemFirst,
        isLast && settingsStyles.listItemLast,
        (focused || pressed) && (onPress ? settingsStyles.listItemFocused : styles.rowFocused),
      ]}>
      {({ focused, pressed }) => {
        // The gold fill is the app's "this acts" mark, so a row that only takes focus to be
        // readable keeps the neutral wash instead of promising a press.
        const onGold = Boolean(onPress) && (focused || pressed);
        return (
          <View style={settingsStyles.listItemContent}>
            <View style={styles.left}>
              <Ionicons name={icon} size={IS_TV ? 32 : 22} color={onGold ? CARD_FOCUS.TITLE_TEXT_FOCUSED : "#FFC312"} />
              <View style={styles.labels}>
                <Text style={[settingsStyles.listItemTitle, onGold && settingsStyles.listItemTitleFocused]} numberOfLines={1}>
                  {title}
                </Text>
                {subtitle ? (
                  <Text style={[settingsStyles.listItemSubtitle, styles.subtitle, onGold && settingsStyles.listItemSubtitleFocused]} numberOfLines={1}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
            </View>
            {accessory === "none" ? null : <Ionicons name={ACCESSORY_ICONS[accessory]} size={IS_TV ? 28 : 20} color={onGold ? CARD_FOCUS.TITLE_TEXT_FOCUSED : "#8E8E93"} />}
          </View>
        );
      }}
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
