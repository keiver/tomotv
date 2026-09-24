import { VideoGridItem } from "@/components/video-grid-item";
import { useLiveFrame } from "@/hooks/useLiveFrame";
import type { JellyfinItem } from "@/types/jellyfin";
import React, { forwardRef, type ComponentProps, type ElementRef } from "react";

type GuideChannelCardProps = Omit<ComponentProps<typeof VideoGridItem>, "video" | "liveFrame" | "slotOrientation"> & { channel: JellyfinItem };

/** A channel's landscape video card, wearing its latest live frame once one has been grabbed. */
export const GuideChannelCard = forwardRef<ElementRef<typeof VideoGridItem>, GuideChannelCardProps>(function GuideChannelCard({ channel, ...cardProps }, ref) {
  const liveFrame = useLiveFrame(channel.Id);
  return <VideoGridItem ref={ref} video={channel} slotOrientation="landscape" liveFrame={liveFrame} {...cardProps} />;
});
