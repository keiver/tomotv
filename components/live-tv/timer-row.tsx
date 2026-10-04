import { ListRow } from "@/components/settings/ListRow";
import { t } from "@/services/i18n";
import type { JellyfinTimer } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { formatClock, formatDayLabel } from "@/utils/guide";
import React from "react";

/** The info panel a schedule row opens: the program's, else the channel's, pinned to the timer when it is one. */
export function timerPanelTarget(timer: JellyfinTimer, series: boolean): { videoId: string; name: string; timerId?: string } | null {
  const timerId = series ? undefined : timer.Id || undefined;
  if (timer.ProgramId) return { videoId: timer.ProgramId, name: timer.Name, timerId };
  if (timer.ChannelId) return { videoId: timer.ChannelId, name: timer.ChannelName ?? timer.Name, timerId };
  return null;
}

interface TimerRowProps {
  timer: JellyfinTimer;
  nowMs: number;
  /** The row names a series rule, drawn as its next airing. */
  series?: boolean;
  onPress: (timer: JellyfinTimer, series: boolean) => void;
  isLast?: boolean;
}

/** One scheduled recording as a settings row: what, then the episode, channel and airing under it. */
function TimerRowComponent({ timer, nowMs, series = false, onPress, isLast = false }: TimerRowProps) {
  const startMs = Date.parse(timer.StartDate);
  const endMs = Date.parse(timer.EndDate);
  const when = `${formatDayLabel(startMs, nowMs, { today: t("liveTv.today"), tomorrow: t("liveTv.tomorrow") })} ${t("liveTv.timeRange").replace("{start}", formatClock(startMs)).replace("{end}", formatClock(endMs))}`;
  const subtitle = [when, cleanLabel(timer.EpisodeTitle), cleanLabel(timer.ChannelName)].filter(Boolean).join("  ·  ");
  // A timer with no program and no channel has no panel to open: it takes focus to be readable, nothing more.
  const opens = timerPanelTarget(timer, series) !== null;
  const open = opens ? () => onPress(timer, series) : undefined;
  return (
    <ListRow
      icon={timer.SeriesTimerId ? "repeat" : "radio-button-on"}
      title={cleanLabel(timer.Name)}
      subtitle={subtitle}
      trailingIcon={opens ? "chevron-forward" : undefined}
      onPress={open}
      onLongPress={open}
      isLast={isLast}
      accessibilityLabel={`${cleanLabel(timer.Name)}, ${subtitle}`}
    />
  );
}

export const TimerRow = React.memo(TimerRowComponent);
