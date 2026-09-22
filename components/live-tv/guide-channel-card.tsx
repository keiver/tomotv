import { VideoGridItem } from "@/components/video-grid-item";
import { useLiveFrame } from "@/hooks/useLiveFrame";
import type { JellyfinItem } from "@/types/jellyfin";
import React from "react";

interface GuideChannelCardProps {
  channel: JellyfinItem;
  index: number;
  width: number;
  onPress: (channel: JellyfinItem) => void;
  onFocus?: () => void;
}

/** A channel's card in the guide column, wearing its latest live frame once one has been grabbed. */
export function GuideChannelCard({ channel, index, width, onPress, onFocus }: GuideChannelCardProps) {
  const liveFrame = useLiveFrame(channel.Id);
  return <VideoGridItem video={channel} index={index} cardWidth={width} slotOrientation="landscape" hideAiring liveFrame={liveFrame} onPress={onPress} onItemFocus={onFocus} />;
}
