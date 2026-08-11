import type { ProseClause } from "@/constants/help-copy";
import { Ionicons } from "@expo/vector-icons";
import { Platform, StyleSheet, Text, TextStyle } from "react-native";

const IS_TV = Platform.isTV;

// Body sizes. TV sits well over the ~29pt floor that stays readable at ten feet
// — the old 24pt subtitle was under it.
const FONT_SIZE = IS_TV ? 32 : 17;
const LINE_HEIGHT = IS_TV ? 46 : 26;
// Icon fonts leave padding inside the em box, so a glyph set at the text size
// draws noticeably smaller than the letters beside it. Matched to the full size
// the marks still read a step quieter than the words, which is the intent.
const GLYPH_SIZE = FONT_SIZE;

interface FeatureProseProps {
  clauses: ProseClause[];
  style?: TextStyle;
}

/** The sentence with every glyph and emphasis stripped — what VoiceOver reads. */
function plainText(clauses: ProseClause[]): string {
  return clauses.map((clause) => `${clause.lead ?? ""}${clause.emphasis}${clause.tail ?? ""}`).join("");
}

/**
 * FeatureProse — the Help screen's feature list, written as a sentence.
 *
 * Replaces a grid of badges: each named capability is a glyph plus a white run
 * inside otherwise grey prose, so the glyph/white pairs are the scan layer and
 * the connective tissue recedes. Two text values carry the entire hierarchy —
 * no tint, no disc, no accent colour. The one accent the app has stays on the
 * things you can actually press.
 *
 * The glyphs are Ionicons, which is a Text-based icon set, so they nest in the
 * paragraph and wrap with the line rather than sitting in their own boxes. A
 * sunken well behind each one is not possible: nested Text ignores borderRadius
 * on iOS. The sunken treatment lives on the rows beside this instead.
 *
 * The whole paragraph is one accessibility element labelled with the plain
 * sentence, so VoiceOver never reads an icon-font codepoint.
 */
export function FeatureProse({ clauses, style }: FeatureProseProps) {
  return (
    <Text style={[styles.paragraph, style]} accessible={true} accessibilityLabel={plainText(clauses)}>
      {clauses.map((clause, index) => (
        <Text key={index}>
          {clause.lead}
          <Ionicons name={clause.icon} size={GLYPH_SIZE} color="#98989D" />
          <Text style={styles.emphasis}>{` ${clause.emphasis}`}</Text>
          {clause.tail}
        </Text>
      ))}
    </Text>
  );
}

const styles = StyleSheet.create({
  // The grey is the page's secondary text colour, shared with the glyphs: the
  // connective words and the marks between them read as one quiet layer.
  paragraph: {
    fontSize: FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    fontWeight: "400",
    color: "#98989D",
  },
  emphasis: {
    color: "#FFFFFF",
    fontWeight: "600",
  },
});
