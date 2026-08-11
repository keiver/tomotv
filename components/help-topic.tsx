import { HelpRow } from "@/components/help-row";
import { Ionicons } from "@expo/vector-icons";
import type { ReactNode } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

type IoniconName = keyof typeof Ionicons.glyphMap;

const IS_TV = Platform.isTV;

interface HelpTopicProps {
  icon: IoniconName;
  /** The question, phrased the way someone hits the problem. */
  title: string;
  /** The answer. Keep it short — see the note on scrolling below. */
  answer?: string;
  /** An answer that isn't prose (the setup QR). Rendered in place of `answer`. */
  children?: ReactNode;
  expanded: boolean;
  onToggle: () => void;
  isFirst?: boolean;
  isLast?: boolean;
  hasTVPreferredFocus?: boolean;
}

/**
 * HelpTopic — one question in the Help list, with its answer folded underneath.
 *
 * Same mechanic as the Acknowledgements screen (`app/licenses.tsx`): the row is
 * the focusable, and the answer renders as a sibling *outside* it rather than as
 * a child. On tvOS anything drawn above a focusable occludes it and the focus
 * engine refuses to enter, so the answer has to sit beside the row in the tree,
 * never over it.
 *
 * The answer itself is plain, unfocusable text, which puts a hard limit on its
 * length: the focus engine only scrolls to reach a focusable, so a block taller
 * than the screen between two rows has a middle the remote can never bring into
 * view. Answers are written to a few sentences for that reason. If one ever needs
 * to run long, it has to become focusable paragraphs the way the license texts
 * do — the length is the constraint, not the styling.
 */
export function HelpTopic({ icon, title, answer, children, expanded, onToggle, isFirst = false, isLast = false, hasTVPreferredFocus = false }: HelpTopicProps) {
  return (
    <View>
      <HelpRow
        icon={icon}
        title={title}
        onPress={onToggle}
        expanded={expanded}
        isFirst={isFirst}
        // The row only caps the card's bottom corners while it is closed; once the
        // answer is showing, the answer is the last thing in the card.
        isLast={isLast && !expanded}
        hasTVPreferredFocus={hasTVPreferredFocus}
      />
      {expanded ? <View style={[styles.body, isLast && styles.bodyLast]}>{children ?? <Text style={styles.answer}>{answer}</Text>}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Recessed against the card so an open answer reads as belonging to the row
  // above it rather than as another row. Matches the license body treatment.
  body: {
    backgroundColor: "rgba(0, 0, 0, 0.25)",
    paddingHorizontal: IS_TV ? 28 : 16,
    paddingTop: IS_TV ? 4 : 2,
    paddingBottom: IS_TV ? 24 : 16,
  },
  bodyLast: {
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
  },
  // A step under the row title, and well over the ~29pt floor that stays readable
  // at ten feet.
  answer: {
    fontSize: IS_TV ? 26 : 15,
    lineHeight: IS_TV ? 38 : 22,
    color: "#C7C7CC",
  },
});
