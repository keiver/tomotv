import { usePlayerSession, type PlayerSessionHandlers } from "@/contexts/PlayerSessionContext";
import type { JellyfinItem } from "@/types/jellyfin";
import { previewTapAction } from "@/utils/guide";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ignore = () => {};

/**
 * Live TV's player slot: a tapped channel plays inline above the guide, another tap switches it, and a tap
 * on the playing channel opens it full screen. The screen owns the host's session the way /player does,
 * and lets it go as the screen leaves: a PiP window carries on, anything else ends.
 */
export function useLivePreview() {
  const { requestSession, switchLiveChannel, presentFullscreen, retry, releaseRoute, setHandlers, clearHandlers, sessionVideoId, hostMode } = usePlayerSession();
  const isFocused = useIsFocused();
  const [channel, setChannel] = useState<JellyfinItem | null>(null);
  const keyRef = useRef<string | null>(null);
  // Read at tap and release time: the host moves the session's channel on a switch.
  const sessionRef = useRef({ videoId: sessionVideoId, hostMode });
  useEffect(() => {
    sessionRef.current = { videoId: sessionVideoId, hostMode };
  }, [sessionVideoId, hostMode]);

  // Closing full screen comes back to the slot, and a live channel never ends on its own.
  const handlers = useMemo<PlayerSessionHandlers>(
    () => ({
      onPlaybackEnd: ignore,
      onContentProposalAccepted: ignore,
      onContentProposalRejected: ignore,
      onInfoPanelItemSelected: ignore,
      onSkipChannel: ignore,
      onTransportBarButtonSelected: ignore,
      onRequestBack: ignore,
      onPipStarted: ignore,
    }),
    [],
  );

  const release = useCallback(() => {
    const key = keyRef.current;
    if (!key) return;
    keyRef.current = null;
    setChannel(null);
    clearHandlers(handlers);
    const videoId = sessionRef.current.videoId;
    if (videoId) releaseRoute({ videoId, sessionKey: key });
  }, [clearHandlers, handlers, releaseRoute]);
  const releaseRef = useRef(release);
  useEffect(() => {
    releaseRef.current = release;
  }, [release]);

  const preview = useCallback(
    (tapped: JellyfinItem) => {
      const { videoId, hostMode: mode } = sessionRef.current;
      const action = previewTapAction(tapped.Id, keyRef.current ? videoId : null, mode);
      if (action === "fullscreen") presentFullscreen();
      else if (action === "retry") retry();
      else if (action === "switch") {
        setChannel(tapped);
        switchLiveChannel({ videoId: tapped.Id, videoName: tapped.Name, picked: true });
      } else if (action === "start") {
        const key = `live-tv:${Date.now()}`;
        keyRef.current = key;
        setChannel(tapped);
        setHandlers(handlers);
        requestSession({ videoId: tapped.Id, videoName: tapped.Name, isLive: true, inline: true, sessionKey: key });
      }
    },
    [handlers, presentFullscreen, retry, switchLiveChannel, setHandlers, requestSession],
  );

  // Navigation focus, never the native stack's transition events: the full-screen player is a modal over this
  // screen, and its arrival reads to the stack as this screen disappearing.
  useEffect(() => {
    if (!isFocused) releaseRef.current();
  }, [isFocused]);
  useEffect(() => () => releaseRef.current(), []);

  return { channel, preview };
}
