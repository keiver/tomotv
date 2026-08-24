import { ListRow } from "@/components/settings/ListRow";
import { PosterMark } from "@/components/settings/PosterMark";
import { SwipeToRemove } from "@/components/settings/SwipeToRemove";
import { downloadManager, type DownloadProgress } from "@/services/downloads/manager";
import type { DownloadEntry } from "@/services/downloads/manifest";
import { formatFileSize } from "@/utils/mediaInfo";
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import type { StyleProp, TextStyle } from "react-native";

type IoniconName = keyof typeof Ionicons.glyphMap;

interface DownloadRowProps {
  entry: DownloadEntry;
  selected: boolean;
  onPress: () => void;
  onRemove: () => void;
  /** Only the rows at the ends of the capped list pin its offset; see the screen. */
  onFocus?: () => void;
  isFirst?: boolean;
  titleStyle?: StyleProp<TextStyle>;
  subtitleStyle?: StyleProp<TextStyle>;
}

/** The second line of a transfer: percent where the size is known, bytes so far where it is not. */
function progressLabel({ bytesWritten, totalBytes }: DownloadProgress): string {
  if (totalBytes <= 0) return `${formatFileSize(bytesWritten)} so far`;
  return `${Math.floor((bytesWritten / totalBytes) * 100)}% · ${formatFileSize(totalBytes)}`;
}

/** What each state says and does, so the row body has no branching of its own. */
function stateCopy(entry: DownloadEntry): { subtitle: string; trailing?: IoniconName } {
  switch (entry.state) {
    case "ready":
      return { subtitle: formatFileSize(entry.totalBytes), trailing: "play" };
    case "downloading":
      return { subtitle: progressLabel(entry), trailing: "pause" };
    case "queued":
      return { subtitle: "Waiting", trailing: "close" };
    case "paused":
      return { subtitle: entry.bytesWritten > 0 ? `Paused at ${formatFileSize(entry.bytesWritten)}` : "Paused", trailing: "arrow-down" };
    case "failed":
      return { subtitle: entry.error ?? "Download failed", trailing: "refresh" };
  }
}

/**
 * One download in the list, watching its own byte counter.
 *
 * The counter is the only thing that moves during a transfer, and it belongs to one row, so it
 * is subscribed here rather than pushed through the screen's state.
 */
export function DownloadRow({ entry, selected, onPress, onRemove, onFocus, isFirst, titleStyle, subtitleStyle }: DownloadRowProps) {
  const [live, setLive] = useState<string | null>(null);

  useEffect(() => {
    if (entry.state !== "downloading") return;
    return downloadManager.subscribeProgress(entry.itemId, (progress) => {
      const next = progressLabel(progress);
      // Identical string, same state: a tick that does not move the percent must not re-render,
      // because every render of the rows re-registers Reanimated worklets that are never freed.
      setLive((current) => (current === next ? current : next));
    });
  }, [entry.itemId, entry.state]);

  const { subtitle, trailing } = stateCopy(entry);
  const line = entry.state === "downloading" ? (live ?? subtitle) : subtitle;

  return (
    <SwipeToRemove label={entry.item.Name} onRemove={onRemove}>
      <ListRow
        icon={() => <PosterMark uri={entry.artworkUri} />}
        title={entry.item.Name}
        subtitle={line}
        trailingIcon={trailing}
        tone={entry.state === "failed" ? "destructive" : "default"}
        selected={selected}
        onPress={onPress}
        onLongPress={onRemove}
        onFocus={onFocus}
        titleStyle={titleStyle}
        subtitleStyle={subtitleStyle}
        isFirst={isFirst}
        accessibilityLabel={entry.item.Name}
        accessibilityState={{ selected }}
        accessibilityHint={entry.state === "ready" ? "Plays from this device. Swipe left or press and hold to remove." : `${line}. Swipe left or press and hold to remove.`}
      />
    </SwipeToRemove>
  );
}
