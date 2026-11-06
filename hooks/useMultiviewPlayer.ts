import { usePlayerSession, type InlineFrame, type PlayerSessionHandlers } from "@/contexts/PlayerSessionContext";
import { tapFeedback } from "@/services/haptics";
import type { JellyfinItem } from "@/types/jellyfin";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const ignore = () => {};

/**
 * Multiview's spot with the sound on iPhone, iPad and Mac: the app's one player plays it inline in the spot, switches to
 * another channel in place when the sound moves, and goes to AVKit's presented player on a press, as the Live TV
 * guide's pinned channel does, so the picture never reloads. Null `channel` lets the session go.
 */
export function useMultiviewPlayer(channel: Pick<JellyfinItem, "Id" | "Name"> | null, focused: boolean) {
  const { requestSession, switchLiveChannel, presentFullscreen, releaseRoute, setHandlers, clearHandlers, setInlineFrame, setInlineOverlay, setInlineMuted, sessionVideoId, hostMode, playbackState } =
    usePlayerSession();
  const keyRef = useRef<string | null>(null);
  const channelIdRef = useRef<string | null>(null);
  // Read at release time: the host moves the session's channel on a switch.
  const sessionVideoIdRef = useRef(sessionVideoId);
  useEffect(() => {
    sessionVideoIdRef.current = sessionVideoId;
  }, [sessionVideoId]);
  const [muted, setMuted] = useState(false);

  const releaseRef = useRef(ignore);
  const handlers = useMemo<PlayerSessionHandlers>(
    () => ({
      onPlaybackEnd: ignore,
      onContentProposalAccepted: ignore,
      onContentProposalRejected: ignore,
      onInfoPanelItemSelected: ignore,
      onSkipChannel: ignore,
      onTransportBarButtonSelected: ignore,
      onRequestBack: () => releaseRef.current(),
      onPipStarted: ignore,
    }),
    [],
  );

  const release = useCallback(() => {
    const key = keyRef.current;
    if (!key) return;
    keyRef.current = null;
    channelIdRef.current = null;
    setInlineFrame(null);
    setInlineOverlay(null);
    setInlineMuted(false);
    clearHandlers(handlers);
    const videoId = sessionVideoIdRef.current;
    if (videoId) releaseRoute({ videoId, sessionKey: key });
  }, [clearHandlers, handlers, releaseRoute, setInlineFrame, setInlineOverlay, setInlineMuted]);
  useEffect(() => {
    releaseRef.current = release;
  }, [release]);

  const channelId = channel?.Id ?? null;
  const channelName = channel?.Name ?? undefined;
  // The player played our channel; once it plays something else, another screen took it, and focus asks for it again.
  const hadSessionRef = useRef(false);
  useEffect(() => {
    if (!channelId) {
      release();
      return;
    }
    if (keyRef.current && sessionVideoId === channelIdRef.current) hadSessionRef.current = true;
    if (keyRef.current && hadSessionRef.current && sessionVideoId !== channelIdRef.current && focused) {
      keyRef.current = null;
      channelIdRef.current = null;
      hadSessionRef.current = false;
    }
    if (keyRef.current && channelIdRef.current === channelId) return;
    if (keyRef.current) {
      channelIdRef.current = channelId;
      hadSessionRef.current = false;
      switchLiveChannel({ videoId: channelId, videoName: channelName, picked: true });
      return;
    }
    const key = `multiview:${Date.now()}`;
    keyRef.current = key;
    channelIdRef.current = channelId;
    setHandlers(handlers);
    requestSession({ videoId: channelId, videoName: channelName, isLive: true, inline: true, multiview: true, sessionKey: key });
  }, [channelId, channelName, focused, sessionVideoId, handlers, release, requestSession, setHandlers, switchLiveChannel]);
  useEffect(() => () => releaseRef.current(), []);

  useEffect(() => {
    if (keyRef.current) setInlineMuted(muted);
  }, [muted, setInlineMuted, sessionVideoId]);
  const toggleMute = useCallback(() => {
    void tapFeedback();
    setMuted((was) => !was);
  }, []);

  /** A press on the spot: AVKit's presented player around the same player, its controls fitting there. */
  const open = useCallback(() => {
    if (keyRef.current) presentFullscreen();
  }, [presentFullscreen]);
  /** Where the spot shows the player, in window coordinates; null parks it, still playing. */
  const setSlot = useCallback((frame: InlineFrame | null) => setInlineFrame(frame), [setInlineFrame]);

  const ours = !!channelId && sessionVideoId === channelId;
  const playing = ours && hostMode !== "error" && playbackState.type === "PLAYING";
  const failed = ours && hostMode === "error";
  return { open, setSlot, setOverlay: setInlineOverlay, playing, failed, muted, toggleMute };
}
