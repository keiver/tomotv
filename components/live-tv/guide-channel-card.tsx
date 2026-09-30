import { VideoGridItem } from "@/components/video-grid-item";
import { useChannelHealth } from "@/hooks/useChannelHealth";
import { useGuideRowFocus } from "@/hooks/useGuideChannelFocus";
import { useLiveClip, useLiveFrame } from "@/hooks/useLiveFrame";
import { usePlaybackHeld } from "@/hooks/usePlaybackHeld";
import type { JellyfinItem } from "@/types/jellyfin";
import React, { forwardRef, type ComponentProps, type ElementRef } from "react";

type GuideChannelCardProps = Omit<ComponentProps<typeof VideoGridItem>, "video" | "liveFrame" | "liveClip" | "clipActive" | "slotOrientation" | "offline"> & {
  channel: JellyfinItem;
  /** The clip plays while the card is in view and playback is not holding the link. */
  playsClipInView?: boolean;
};

/** A channel's landscape video card, wearing its latest live frame and its preview clip while it or its guide row holds focus. */
export const GuideChannelCard = forwardRef<ElementRef<typeof VideoGridItem>, GuideChannelCardProps>(function GuideChannelCard({ channel, playsClipInView = false, ...cardProps }, ref) {
  const liveFrame = useLiveFrame(channel.Id);
  const liveClip = useLiveClip(channel.Id);
  const rowFocused = useGuideRowFocus(channel.Id);
  const held = usePlaybackHeld();
  // A frame on screen outranks any verdict: the card never says Offline over live pictures.
  const offline = useChannelHealth(channel.Id) === "down" && !liveFrame;
  const clipActive = rowFocused || (playsClipInView && !held);
  return <VideoGridItem ref={ref} video={channel} slotOrientation="landscape" liveFrame={liveFrame} liveClip={liveClip} clipActive={clipActive} offline={offline} {...cardProps} />;
});
