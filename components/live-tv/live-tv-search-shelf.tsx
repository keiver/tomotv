import { MediaShelf } from "@/components/media-shelf";
import { VideoGridItem } from "@/components/video-grid-item";
import { itemSlotShape } from "@/constants/app";
import { useOpenShelfItem } from "@/hooks/useOpenShelfItem";
import { t } from "@/services/i18n";
import type { JellyfinItem, JellyfinVideoItem } from "@/types/jellyfin";
import React, { useCallback } from "react";

const slotShapeFor = (item: JellyfinVideoItem) => itemSlotShape(item.PrimaryImageAspectRatio);
const keyFor = (item: JellyfinVideoItem) => item.Id;

/** Live TV matches above the search grid: channels, then programmes on now, then later ones. */
export function LiveTvSearchShelf({ items }: { items: readonly JellyfinVideoItem[] }) {
  const openItem = useOpenShelfItem();
  const open = useCallback((item: JellyfinVideoItem) => openItem(item as JellyfinItem), [openItem]);
  const renderItem = useCallback(
    (item: JellyfinVideoItem, index: number, cardHeight: number) => <VideoGridItem video={item} onPress={open} index={index} cardHeight={cardHeight} fitArtwork slotOrientation="landscape" />,
    [open],
  );
  return <MediaShelf title={t("liveTv.title")} data={items} slotShapeFor={slotShapeFor} renderItem={renderItem} keyExtractor={keyFor} />;
}
