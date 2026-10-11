/**
 * How long the reported subtitle selection has to hold still before it counts as the
 * viewer's choice: past the churn starting an item causes, short enough that backing
 * out right after changing tracks still records it.
 */
export const SUBTITLE_CAPTURE_SETTLE_MS = 1500;
/** The engine fails a segment request after this long (Remuxer.swift); the pre-flight waits no longer. */
export const ENGINE_SEGMENT_DEADLINE_MS = 20_000;
/** Longest pre-flight for a session still pulling its opening segment at the link's pace. */
export const ENGINE_PREFLIGHT_CAP_MS = 60_000;
/** Share of the measured link AVPlayer may commit to: the rest is headroom for the link moving. */
export const LINK_CAP_SHARE = 0.8;
/** A cap moving less than this is not worth re-evaluating the variant for. */
export const LINK_CAP_HYSTERESIS = 0.15;
/** Margin over the source rate at which the link carries the copy (linkAffordsChapterFrames). */
export const LINK_CLIMB_MARGIN = 1.2;
/** How often AVPlayer's buffer reaches the engine; it counts a report older than 3s as gone. */
export const PLAYER_BUFFER_REPORT_MS = 1000;
/** What AVPlayer buffers ahead to reach the first frame on the rung lane, where its own threshold costs a server encode per segment. */
export const SLIPSTREAM_FORWARD_BUFFER_SECONDS = 12;
/** Segments ahead a read-bound live start buffers before the player binds; runway against origin jitter. */
export const LIVE_START_BUFFER_SEGMENTS = 2;
/** Longest the live start gate holds the spinner for that runway. */
export const LIVE_START_BUFFER_CAP_MS = 8_000;
/** Bytes AVPlayer may hold ahead once playing: automatic held 52s of a 110 Mb/s copy and the 3 GB TV killed the app. */
export const FORWARD_BUFFER_BYTES = 200_000_000;
/** AVPlayer's automatic depth (measured 50-55s on T105); a budget reaching it leaves automatic in place. */
export const FORWARD_BUFFER_AUTOMATIC_SECONDS = 50;
/** A live stream the player has not opened by then is treated as dropped; the live ladder takes it. */
export const LIVE_START_DEADLINE_MS = 45_000;
/**
 * A movie the player has not opened by then bails to its next lane. Wide enough to clear the
 * presented-player warmup and a copy's first-segment pull, short enough to beat AVPlayer's own
 * ~38s stall watchdog.
 */
export const VOD_OPEN_DEADLINE_MS = 25_000;
/** A direct stream frozen this long after a buffer-empty edge is stalled, not filling. */
export const DIRECT_STALL_DEADLINE_MS = 12_000;
/** A live channel frozen this long after a buffer-empty edge has failed; left alone, its server transcode never ends. */
export const LIVE_STALL_DEADLINE_MS = 60_000;
/** Playhead movement that counts as progress rather than a frozen clock. */
export const PLAYHEAD_EPSILON_SEC = 0.25;
/** The largest gap between two progress ticks that still reads as playback; a bigger one is a seek. */
export const PLAYHEAD_STEP_MAX_SEC = 2;
