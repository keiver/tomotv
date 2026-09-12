import { ListRow } from "@/components/settings/ListRow";
import { t } from "@/services/i18n";
import type { JellyfinTimer } from "@/types/jellyfin";
import { formatClock, formatDayLabel } from "@/utils/guide";
import React from "react";

interface TimerRowProps {
  timer: JellyfinTimer;
  nowMs: number;
  onPress: (timer: JellyfinTimer) => void;
  isLast?: boolean;
}

/** One scheduled recording as a settings row: what, then the episode, channel and airing under it. */
function TimerRowComponent({ timer, nowMs, onPress, isLast = false }: TimerRowProps) {
  const startMs = Date.parse(timer.StartDate);
  const endMs = Date.parse(timer.EndDate);
  const when = `${formatDayLabel(startMs, nowMs, { today: t("liveTv.today"), tomorrow: t("liveTv.tomorrow") })} ${formatClock(startMs)} to ${formatClock(endMs)}`;
  const subtitle = [when, timer.EpisodeTitle, timer.ChannelName].filter(Boolean).join("  ·  ");
  // A timer with no program has no panel to open: it takes focus to be readable, nothing more.
  const opens = Boolean(timer.ProgramId);
  return (
    <ListRow
      icon={timer.SeriesTimerId ? "repeat" : "radio-button-on"}
      title={timer.Name}
      subtitle={subtitle}
      trailingIcon={opens ? "chevron-forward" : undefined}
      onPress={opens ? () => onPress(timer) : undefined}
      isLast={isLast}
      accessibilityLabel={`${timer.Name}, ${subtitle}`}
    />
  );
}

export const TimerRow = React.memo(TimerRowComponent);
