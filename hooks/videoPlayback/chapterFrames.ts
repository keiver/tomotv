/**
 * When the device may make chapter pictures for the tvOS info panel.
 *
 * The grabber reads the source to decode a keyframe, so it competes with the stream. It ran from
 * item build once and stole a throttled link (b160d963); here it waits for a viewer who has asked
 * for the chrome on a session that is already playing steadily.
 */

import type { PlaybackMode } from "@/hooks/videoPlayback/machine";

export interface ChapterFramesInput {
  /** The panel is tvOS only; no other platform has a chapter strip. */
  isTV: boolean;
  /** Chapters the server has no picture for. One chapter is not a strip. */
  untaggedChapters: number;
  /** Playback has settled, so the opening of the stream is over. */
  stable: boolean;
  /** The viewer summoned the controls after that: AVKit reports the bar visible at +0.3s by itself. */
  controlsSeen: boolean;
  mode: PlaybackMode;
  /** The engine measured the link below the source and moved to a server rung. */
  ridingRung: boolean;
  /** A downloaded or local file: a grab reads the disk and costs the stream nothing. */
  fromDisk: boolean;
}

export function mayGrabChapterFrames(input: ChapterFramesInput): boolean {
  if (!input.isTV || input.untaggedChapters < 2) return false;
  if (input.mode === "transcode") return false;
  if (input.fromDisk) return input.stable;
  return input.stable && input.controlsSeen && !input.ridingRung;
}
