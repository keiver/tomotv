import { VideoGridItem } from "@/components/video-grid-item";
import { useChannelHealth } from "@/hooks/useChannelHealth";
import { useGuideRowFocus } from "@/hooks/useGuideChannelFocus";
import { useLiveClip, useLiveFrame, useLivePreview } from "@/hooks/useLiveFrame";
import type { JellyfinItem } from "@/types/jellyfin";
import React, { forwardRef, type ComponentProps, type ElementRef } from "react";

type GuideChannelCardProps = Omit<ComponentProps<typeof VideoGridItem>, "video" | "liveFrame" | "liveClip" | "clipActive" | "slotOrientation" | "offline"> & {
  channel: JellyfinItem;
};

/** A channel's landscape video card, wearing its latest live frame and its preview clip while it or its guide row holds focus. */
export const GuideChannelCard = forwardRef<ElementRef<typeof VideoGridItem>, GuideChannelCardProps>(function GuideChannelCard({ channel, ...cardProps }, ref) {
  const liveFrame = useLiveFrame(channel.Id);
  const recordedClip = useLiveClip(channel.Id);
  // The live preview outranks the recorded clip; both play through the one shared preview player.
  const liveClip = useLivePreview(channel.Id) ?? recordedClip;
  const rowFocused = useGuideRowFocus(channel.Id);
  // A frame on screen outranks any verdict: the card never says Offline over live pictures.
  const offline = useChannelHealth(channel.Id) === "down" && !liveFrame;
  return <VideoGridItem ref={ref} video={channel} slotOrientation="landscape" liveFrame={liveFrame} liveClip={liveClip} clipActive={rowFocused} offline={offline} {...cardProps} />;
});
