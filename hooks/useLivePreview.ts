import { usePlayerSession, type InlineFrame, type PlayerSessionHandlers } from "@/contexts/PlayerSessionContext";
import type { LiveMarkState } from "@/components/live-tv/guide-live-mark";
import { useRecordingHoldChoices } from "@/hooks/useRecordingHoldChoices";
import { tapFeedback } from "@/services/haptics";
import { t } from "@/services/i18n";
import { dismissToast, showToast } from "@/services/toast";
import type { JellyfinItem } from "@/types/jellyfin";
import { cleanLabel } from "@/utils/cleanLabel";
import { previewTapAction } from "@/utils/guide";
import { useIsFocused, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert } from "react-native";

const ignore = () => {};
const TOAST_ID = "live-preview";

/**
 * Live TV's PiP channel: a tapped channel opens in a PiP window over the guide, another tap switches it, and a
 * tap on the playing channel opens it full screen. The screen owns the host's session the way /player does, and
 * lets it go when the window is closed or as the screen leaves: a PiP window carries on, anything else ends.
 * The channel's card says it is opening and then that it plays in the window; a failure says it failed in a toast,
 * and a recording holding the provider asks.
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
  // The window's close ends the session; closing full screen goes back to the window, which the host does.
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

  const preview = useCallback(
    (tapped: JellyfinItem, frame?: InlineFrame) => {
      const { videoId, hostMode: mode } = sessionRef.current;
      const action = previewTapAction(tapped.Id, keyRef.current ? videoId : null, mode);
      if (action !== "none") void tapFeedback();
      // The tapped card is where the channel plays until its PiP window takes it.
      if ((action === "start" || action === "switch") && frame) setInlineFrame(frame);
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
    [handlers, presentFullscreen, retry, switchLiveChannel, setHandlers, requestSession, setInlineFrame],
  );

  const openRecording = useCallback((item: JellyfinItem) => router.push({ pathname: "/player", params: { videoId: item.Id, videoName: item.Name } }), [router]);
  const hold = useRecordingHoldChoices(sessionVideoId ?? channel?.Id ?? "", playbackState, retry, openRecording);

  // The channel's card says it is opening, a switch inside the PiP window included, then that it plays in the window.
  const channelId = channel?.Id ?? null;
  const markState: LiveMarkState | null =
    !channelId || hostMode === "error" || hostMode === "idle" || hostMode === "pip-detached"
      ? null
      : playbackState.type !== "PLAYING" || hold.stopping
        ? "tuning"
        : hostMode === "pip-active"
          ? "pip"
          : null;
  const mark = useMemo(() => (channelId && markState ? { channelId, state: markState } : null), [channelId, markState]);

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

  return { channel, preview, mark };
}
