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
 * owns the host's session the way /player does. A failure says so in a toast, a recording holding the provider asks, and
 * one the band started plays in the band.
 */
export function useLivePreview() {
  const { requestSession, switchLiveChannel, presentFullscreen, retry, releaseRoute, setHandlers, clearHandlers, setInlineFrame, sessionVideoId, hostMode, playbackState } = usePlayerSession();
  const isFocused = useIsFocused();
  const router = useRouter();
  const [channel, setChannel] = useState<JellyfinItem | null>(null);
  const keyRef = useRef<string | null>(null);
  const channelIdRef = useRef<string | null>(null);
  // The pinned channel this device started a recording on: a hold on its provider plays the recording in the band.
  const [recordingFor, setRecordingFor] = useState<string | null>(null);
  const inlineWatchRef = useRef(false);
  // The band plays the pinned channel's recording, not the channel.
  const playsRecordingRef = useRef(false);
  const [playsRecording, setPlaysRecording] = useState(false);
  const hostModeRef = useRef(hostMode);
  useEffect(() => {
    hostModeRef.current = hostMode;
  }, [hostMode]);
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
    channelIdRef.current = null;
    playsRecordingRef.current = false;
    inlineWatchRef.current = false;
    setPlaysRecording(false);
    setRecordingFor(null);
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
      const playsRecording = playsRecordingRef.current;
      const action = playsRecording ? (tapped.Id === channelIdRef.current ? "none" : "start") : pinTapAction(tapped.Id, keyRef.current ? videoId : null, mode);
      if (action === "none") return;
      void tapFeedback();
      setRecordingFor(null);
      if (action === "retry") retry();
      else if (action === "switch") {
        channelIdRef.current = tapped.Id;
        setChannel(tapped);
        switchLiveChannel({ videoId: tapped.Id, videoName: tapped.Name, picked: true });
      } else {
        const key = `live-tv:${Date.now()}`;
        keyRef.current = key;
        channelIdRef.current = tapped.Id;
        playsRecordingRef.current = false;
        setPlaysRecording(false);
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
      if (!keyRef.current || channelIdRef.current !== channelId) return false;
      presentFullscreen();
      return true;
    },
    [presentFullscreen],
  );

  /** A tap on the band's player: the presented player, where AVKit's controls fit. */
  const open = useCallback(() => {
    if (keyRef.current) presentFullscreen();
  }, [presentFullscreen]);

  /** Where the band shows the player; null parks it, still playing. */
  const setSlot = useCallback((frame: InlineFrame | null) => setInlineFrame(frame), [setInlineFrame]);

  const openRecording = useCallback(
    (item: JellyfinItem) => {
      const key = keyRef.current;
      if (key && inlineWatchRef.current) {
        inlineWatchRef.current = false;
        playsRecordingRef.current = true;
        setPlaysRecording(true);
        requestSession({ videoId: item.Id, videoName: item.Name, inline: true, sessionKey: key });
        return;
      }
      router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name } });
    },
    [router, requestSession],
  );
  const hold = useRecordingHoldChoices(sessionVideoId ?? channel?.Id ?? "", playbackState, retry, openRecording);

  /** The band's record button is about to start a recording on the pinned channel. */
  const expectRecording = useCallback(() => {
    if (keyRef.current && channelIdRef.current) setRecordingFor(channelIdRef.current);
  }, []);
  /** The record write answered: with no hold on the provider the pin plays on, and a failed write brings the channel back. */
  const recordingSettled = useCallback(
    (landed: boolean) => {
      if (landed && hostModeRef.current === "error") return;
      setRecordingFor(null);
      if (!landed && hostModeRef.current === "error") retry();
    },
    [retry],
  );

  // The recording this device started holds the provider: it plays in the band once it has the stream, asking nothing.
  const recordingHere = !!channel && recordingFor === channel.Id && hostMode === "error";
  const watchesHere = recordingHere && hold.held && !!hold.holdingTimer && !hold.opening;
  const { watch } = hold;
  useEffect(() => {
    if (!watchesHere) return;
    inlineWatchRef.current = true;
    // Deliberate cascade: one watch per hold, and a watch that finds no recording leaves the hold's alert to ask.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRecordingFor(null);
    watch();
  }, [watchesHere, watch]);

  // A failure says so; a recording's hold asks instead.
  const failed = !!channel && hostMode === "error" && !hold.held && !recordingHere;
  const channelName = cleanLabel(channel?.Name);
  useEffect(() => {
    if (failed) showToast({ id: TOAST_ID, title: t("player.unableToPlay"), message: channelName, kind: "error" });
    else dismissToast(TOAST_ID);
  }, [failed, channelName]);

  // A recording holding the provider: why, and the two ways out, asked once per hold.
  const askedRef = useRef<string | null>(null);
  const holdKey = channel && hostMode === "error" && hold.held && hold.reason && !hold.stopping && !hold.opening && !recordingHere ? `${channel.Id}|${hold.holdingTimer?.Id ?? ""}` : null;
  useEffect(() => {
    if (!holdKey || askedRef.current === holdKey) return;
    askedRef.current = holdKey;
    inlineWatchRef.current = false;
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

  // The pinned channel, or its recording, is opening (its band shows the card's own clip meanwhile) until it plays.
  const opening = !!channel && ((hostMode !== "error" && playbackState.type !== "PLAYING") || recordingHere || hold.opening);
  return { channel, opening, playsRecording, pin, close, open, fullscreen, setSlot, expectRecording, recordingSettled };
}
