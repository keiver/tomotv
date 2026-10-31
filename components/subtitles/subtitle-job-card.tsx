import { SubtitleResultRow } from "@/components/subtitles/subtitle-result-row";
import { SubtitleSearchField } from "@/components/subtitles/subtitle-search-field";
import { COLORS } from "@/constants/colors";
import { DESIGN } from "@/constants/app";
import { useCardPalette } from "@/hooks/useCardPalette";
import { jobErrorLine, jobNoteLine, jobStateLine } from "@/services/subtitles/jobText";
import type { SubtitleHit, SubtitleJob } from "@/services/subtitles/types";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;

interface SubtitleJobCardProps {
  job: SubtitleJob;
  /** The card opens by itself when it is the only one. */
  alone: boolean;
  onPick: (hit: SubtitleHit) => void;
  onKeywords: (keywords: string) => void;
}

/** One file: its label and title on the left, its state on the right, its results and query inside. */
export function SubtitleJobCard({ job, alone, onPick, onKeywords }: SubtitleJobCardProps) {
  const palette = useCardPalette();
  const [open, setOpen] = useState(alone);
  const expanded = alone || open;
  const busy = job.status === "searching" || job.status === "applying";
  const note = jobNoteLine(job);
  const error = jobErrorLine(job);
  return (
    <View style={styles.card}>
      {alone ? null : (
        <Pressable
          onPress={() => setOpen((value) => !value)}
          isTVSelectable
          tvParallaxProperties={{ magnification: 1.0 }}
          accessibilityRole="button"
          accessibilityState={{ expanded }}
          style={({ focused }) => [styles.header, focused && { borderColor: palette.accent }]}>
          <View style={styles.headerContent} collapsable={false}>
            {job.label ? <Text style={[styles.label, { color: palette.accent }]}>{job.label}</Text> : null}
            <Text style={styles.title} numberOfLines={1}>
              {job.title}
            </Text>
            <View style={styles.state}>
              {busy ? <ActivityIndicator color={palette.accent} /> : null}
              <Text style={[styles.stateText, job.status === "applied" && { color: palette.accent }]}>{jobStateLine(job)}</Text>
              <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={IS_TV ? 28 : 18} color={COLORS.TEXT_TERTIARY} />
            </View>
          </View>
        </Pressable>
      )}
      {expanded ? (
        <View style={styles.body}>
          {alone ? (
            <View style={styles.aloneState}>
              {busy ? <ActivityIndicator color={palette.accent} /> : null}
              <Text style={[styles.stateText, job.status === "applied" && { color: palette.accent }]}>{jobStateLine(job)}</Text>
            </View>
          ) : null}
          {note ? <Text style={styles.note}>{note}</Text> : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <SubtitleSearchField value={job.query.keywords} onSubmit={onKeywords} />
          <View style={styles.results}>
            {job.results.map((hit) => (
              <SubtitleResultRow
                key={`${hit.source}:${hit.id}`}
                hit={hit}
                applying={job.status === "applying" && job.picked?.id === hit.id}
                applied={job.status === "applied" && job.picked?.id === hit.id}
                onPress={() => onPick(hit)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.SURFACE,
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    overflow: "hidden",
  },
  header: {
    borderWidth: IS_TV ? 3 : 2,
    borderColor: "transparent",
    borderRadius: DESIGN.BORDER_RADIUS_CARD,
    paddingVertical: IS_TV ? 22 : 14,
    paddingHorizontal: IS_TV ? 28 : 16,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 20 : 12,
  },
  label: {
    fontSize: IS_TV ? 30 : 17,
    fontWeight: "800",
    letterSpacing: 1,
    fontVariant: ["tabular-nums"],
  },
  title: {
    flex: 1,
    color: COLORS.TEXT_PRIMARY,
    fontSize: IS_TV ? 28 : 17,
    fontWeight: "600",
  },
  state: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 12 : 8,
  },
  aloneState: {
    flexDirection: "row",
    alignItems: "center",
    gap: IS_TV ? 12 : 8,
  },
  stateText: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 22 : 14,
  },
  body: {
    paddingHorizontal: IS_TV ? 28 : 16,
    paddingBottom: IS_TV ? 24 : 14,
    paddingTop: IS_TV ? 8 : 4,
    gap: IS_TV ? 12 : 8,
  },
  note: {
    color: COLORS.TEXT_SECONDARY,
    fontSize: IS_TV ? 20 : 13,
  },
  error: {
    color: COLORS.DESTRUCTIVE_SOFT,
    fontSize: IS_TV ? 20 : 13,
  },
  results: {
    gap: IS_TV ? 6 : 2,
    marginTop: IS_TV ? 8 : 4,
  },
});
