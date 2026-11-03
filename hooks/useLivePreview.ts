import { usePlayerSession, type InlineFrame, type PlayerSessionHandlers } from "@/contexts/PlayerSessionContext";
import { useRecordingHoldChoices } from "@/hooks/useRecordingHoldChoices";
import { tapFeedback } from "@/services/haptics";
import { t } from "@/services/i18n";
import { dismissToast, showToast } from "@/services/toast";
import type { JellyfinItem } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { pinTapAction } from "@/utils/guide";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

const ignore = () => {};
const TOAST_ID = "live-preview";

/**
 * Live TV's pinned channel: a tapped card pins its channel at the top of the guide, playing with sound and AVKit's
 * controls, another card's tap switches the pin, and its close button or the screen leaving lets it go. The screen
 * owns the host's session the way /player does. A failure says so in a toast, and a recording holding the provider asks.
 */
export function useLivePreview() {
  const { requestSession, switchLiveChannel, presentFullscreen, retry, releaseRoute, setHandlers, clearHandlers, setInlineFrame, sessionVideoId, hostMode, playbackState } = usePlayerSession();
  const isFocused = useIsFocused();
  const router = useRouter();
  const [channel, setChannel] = useState<JellyfinItem | null>(null);
  const keyRef = useRef<string | null>(null);
  // Read at tap and release time: the host moves the session's channel on a switch.
  const sessionRef = useRef({ videoId: sessionVideoId, hostMode });
  useEffect(() => {
    sessionRef.current = { videoId: sessionVideoId, hostMode };
  }, [sessionVideoId, hostMode]);

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
    setChannel(null);
    dismissToast(TOAST_ID);
    setInlineFrame(null);
    clearHandlers(handlers);
    const videoId = sessionRef.current.videoId;
    if (videoId) releaseRoute({ videoId, sessionKey: key });
  }, [clearHandlers, handlers, releaseRoute, setInlineFrame]);
  useEffect(() => {
    releaseRef.current = release;
  }, [release]);

  const pin = useCallback(
    (tapped: JellyfinItem) => {
      const { videoId, hostMode: mode } = sessionRef.current;
      const action = pinTapAction(tapped.Id, keyRef.current ? videoId : null, mode);
      if (action === "none") return;
      void tapFeedback();
      if (action === "retry") retry();
      else if (action === "switch") {
        setChannel(tapped);
        switchLiveChannel({ videoId: tapped.Id, videoName: tapped.Name, picked: true });
      } else {
        const key = `live-tv:${Date.now()}`;
        keyRef.current = key;
        setChannel(tapped);
        setHandlers(handlers);
        requestSession({ videoId: tapped.Id, videoName: tapped.Name, isLive: true, inline: true, sessionKey: key });
      }
    },
    [handlers, retry, switchLiveChannel, setHandlers, requestSession],
  );

  const close = useCallback(() => {
    if (!keyRef.current) return;
    void tapFeedback();
    release();
  }, [release]);

  /** The pinned channel's own programme opens it full screen, with no new session; false for any other channel. */
  const fullscreen = useCallback(
    (channelId: string) => {
      if (!keyRef.current || sessionRef.current.videoId !== channelId) return false;
      presentFullscreen();
      return true;
    },
    [presentFullscreen],
  );

  /** Where the band shows the player; null parks it, still playing. */
  const setSlot = useCallback((frame: InlineFrame | null) => setInlineFrame(frame), [setInlineFrame]);

  const openRecording = useCallback((item: JellyfinItem) => router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name } }), [router]);
  const hold = useRecordingHoldChoices(sessionVideoId ?? channel?.Id ?? "", playbackState, retry, openRecording);

  // A failure says so; a recording's hold asks instead.
  const failed = !!channel && hostMode === "error" && !hold.held;
  const channelName = cleanLabel(channel?.Name);
  useEffect(() => {
    if (failed) showToast({ id: TOAST_ID, title: t("player.unableToPlay"), message: channelName, kind: "error" });
    else dismissToast(TOAST_ID);
  }, [failed, channelName]);

  // A recording holding the provider: why, and the two ways out, asked once per hold.
  const askedRef = useRef<string | null>(null);
  const holdKey = channel && hostMode === "error" && hold.held && hold.reason && !hold.stopping && !hold.opening ? `${channel.Id}|${hold.holdingTimer?.Id ?? ""}` : null;
  useEffect(() => {
    if (!holdKey || askedRef.current === holdKey) return;
    askedRef.current = holdKey;
    const choices: Parameters<typeof Alert.alert>[2] = [{ text: t("common.cancel"), style: "cancel", onPress: () => releaseRef.current() }];
    if (hold.holdingTimer) {
      choices.push({ text: t("liveTv.stopRecordingAndPlay"), onPress: hold.stopAndPlay }, { text: t("liveTv.watchRecording"), onPress: hold.watch });
    }
    Alert.alert(channelName, hold.reason ?? undefined, choices);
  }, [holdKey, hold.holdingTimer, hold.reason, hold.stopAndPlay, hold.watch, channelName]);
  useEffect(() => {
    if (!holdKey) askedRef.current = null;
  }, [holdKey]);

  // Navigation focus, never the native stack's transition events: the full-screen player is a modal over this
  // screen, and its arrival reads to the stack as this screen disappearing.
  useEffect(() => {
    if (!isFocused) releaseRef.current();
  }, [isFocused]);
  useEffect(() => () => releaseRef.current(), []);

  // The pinned channel is opening (its band shows the card's own clip meanwhile) until it plays.
  const opening = !!channel && hostMode !== "error" && playbackState.type !== "PLAYING";
  return { channel, opening, pin, close, fullscreen, setSlot };
}
