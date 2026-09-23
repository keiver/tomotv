import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** A card holding an empty state: what is missing, and in its footer, what to do about it. */
type IconName = React.ComponentProps<typeof Ionicons>["name"];

export function EmptyCard({ icon, text, note, noteIcon }: { icon: IconName; text: string; note?: string; noteIcon?: IconName }) {
  return (
    <View style={settingsStyles.section}>
      <View style={styles.card}>
        <Ionicons name={icon} size={IS_TV ? 72 : 56} color={COLORS.TEXT_QUATERNARY} />
        <Text style={styles.text}>{text}</Text>
      </View>
      {note ? (
        <SectionFooter>
          <View style={[settingsStyles.sectionNote, styles.note]}>
            {noteIcon ? <Ionicons name={noteIcon} size={IS_TV ? 24 : 16} color={COLORS.TEXT_TERTIARY} /> : null}
            <Text style={[styles.noteText, { fontSize: settingsStyles.sectionNote.fontSize, lineHeight: settingsStyles.sectionNote.lineHeight, color: settingsStyles.sectionNote.color }]}>{note}</Text>
          </View>
        </SectionFooter>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Tall enough not to read as a stray line of text where a list of rows was.
  card: {
    minHeight: IS_TV ? 200 : 140,
    alignItems: "center",
    justifyContent: "center",
    gap: IS_TV ? 24 : 16,
    paddingHorizontal: IS_TV ? 48 : 24,
    paddingVertical: IS_TV ? 40 : 24,
  },
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 14 : 10,
  },
  noteText: {
    flex: 1,
  },
  text: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 26 : 15,
    lineHeight: IS_TV ? 36 : 21,
    textAlign: "center",
  },
});
