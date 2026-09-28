import { VideoGridItem } from "@/components/video-grid-item";
import { useChannelHealth } from "@/hooks/useChannelHealth";
import { useLiveClip, useLiveFrame } from "@/hooks/useLiveFrame";
import type { JellyfinItem } from "@/types/jellyfin";
import React, { forwardRef, type ComponentProps, type ElementRef } from "react";

type GuideChannelCardProps = Omit<ComponentProps<typeof VideoGridItem>, "video" | "liveFrame" | "liveClip" | "slotOrientation" | "offline"> & { channel: JellyfinItem };

/** A channel's landscape video card, wearing its latest live frame once one has been grabbed and its preview clip on focus. */
export const GuideChannelCard = forwardRef<ElementRef<typeof VideoGridItem>, GuideChannelCardProps>(function GuideChannelCard({ channel, ...cardProps }, ref) {
  const liveFrame = useLiveFrame(channel.Id);
  const liveClip = useLiveClip(channel.Id);
  // A frame on screen outranks any verdict: the card never says Offline over live pictures.
  const offline = useChannelHealth(channel.Id) === "down" && !liveFrame;
  return <VideoGridItem ref={ref} video={channel} slotOrientation="landscape" liveFrame={liveFrame} liveClip={liveClip} offline={offline} {...cardProps} />;
});
