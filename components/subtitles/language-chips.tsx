import { FilterChip } from "@/components/filter-chip";
import { t } from "@/services/i18n";
import { ALL_LANGUAGES, type SubtitleLanguage } from "@/services/subtitles/languages";
import React, { useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";

interface LanguageChipsProps {
  choices: SubtitleLanguage[];
  selected: string;
  onSelect: (code: string) => void;
}

/** One chip per likely language, a More chip opening the whole table; one selected at a time. */
export function LanguageChips({ choices, selected, onSelect }: LanguageChipsProps) {
  const [expanded, setExpanded] = useState(false);
  const shown = useMemo(() => {
    if (expanded) return ALL_LANGUAGES;
    const extra = ALL_LANGUAGES.find((row) => row.code === selected && !choices.some((choice) => choice.code === selected));
    return extra ? [...choices, extra] : choices;
  }, [choices, expanded, selected]);
  return (
    <View style={styles.row} accessibilityRole="radiogroup">
      {shown.map((row, position) => (
        <FilterChip key={row.code} label={row.native} selected={row.code === selected} onToggle={() => onSelect(row.code)} hasTVPreferredFocus={position === 0} />
      ))}
      <FilterChip label={expanded ? t("subtitles.fewerLanguages") : t("subtitles.moreLanguages")} selected={false} onToggle={() => setExpanded((value) => !value)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: Platform.isTV ? 14 : 8,
  },
});
