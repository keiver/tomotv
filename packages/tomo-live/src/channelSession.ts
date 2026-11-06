import { localRemuxToken, originHeld, stopLocalRemux } from "@keiver/tomo-engine";
import { liveChannels } from "./config";
import { playlistChannelById } from "./playlistChannels";

export interface StartedChannelSession {
  details: unknown;
  url: string;
  token: string;
}

/** A channel's engine session, opened on the server only with `openOnServer`. `unavailable`: no session without a server open;
 *  `held`: a recording or `allow` refused it; `stale`: `current` turned false, nothing left open. A failed start throws. */
export async function startChannelSession(
  channelId: string,
  options: { windowSeconds: number; priority: "preview" | "playback"; current: () => boolean; openOnServer?: boolean; allow?: (details: unknown) => boolean },
): Promise<StartedChannelSession | "unavailable" | "held" | "stale"> {
  if (originHeld(playlistChannelById(channelId)?.originKey)) return "held";
  const channels = liveChannels();
  const details = options.openOnServer ? await channels.resolve(channelId, { quiet: true }) : await channels.resolveWithoutOpen(channelId);
  const release = () => {
    if (details && channels.holdsOpen(details)) void channels.close(details);
  };
  if (!options.current()) {
    release();
    return "stale";
  }
  if (!details || !channels.streamUrl(details) || !(await channels.canPlayOnDevice(details))) {
    release();
    return "unavailable";
  }
  // The caller's own terms, read off the resolved channel: its provider may have no room for it.
  if (options.allow && !options.allow(details)) {
    release();
    return "held";
  }
  if (!options.current()) {
    release();
    return "stale";
  }
  let url: string;
  try {
    url = await channels.startSession(details, { prewarm: true, liveWindowSeconds: options.windowSeconds, livePriority: options.priority });
  } catch (error) {
    release();
    throw error;
  }
  const token = localRemuxToken(url);
  if (!token || !options.current()) {
    void stopLocalRemux(token);
    release();
    return "stale";
  }
  return { details, url, token };
}
