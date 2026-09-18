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
/** The link must clear the source rate by this margin before a climb back to the copy. */
export const LINK_CLIMB_MARGIN = 1.2;
/** How long the link must carry the source before the session is rebuilt on the on-device copy. */
export const LINK_CLIMB_HOLD_MS = 5_000;
/** Smallest gap between two such rebuilds, so a link hovering at the source rate cannot bounce. */
export const LINK_CLIMB_COOLDOWN_MS = 60_000;
/** What AVPlayer buffers ahead to reach the first frame on the rung lane, where its own threshold costs a server encode per segment. */
export const SLIPSTREAM_FORWARD_BUFFER_SECONDS = 12;
/** A live stream the player has not opened by then is treated as dropped; the live ladder takes it. */
export const LIVE_START_DEADLINE_MS = 45_000;
/**
 * A movie the player has not opened by then bails to its next lane. Wide enough to clear the
 * presented-player warmup and a copy's first-segment pull, short enough to beat AVPlayer's own
 * ~38s stall watchdog.
 */
export const VOD_OPEN_DEADLINE_MS = 25_000;
/** Smallest gap between climb-backs to the on-device copy, each of which re-buffers. */
export const CLIMB_BACK_COOLDOWN_MS = 60_000;
/** A direct stream frozen this long after a buffer-empty edge is stalled, not filling. */
export const DIRECT_STALL_DEADLINE_MS = 12_000;
/** Playhead movement that counts as progress rather than a frozen clock. */
export const PLAYHEAD_EPSILON_SEC = 0.25;
