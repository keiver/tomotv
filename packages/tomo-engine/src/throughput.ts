/** One completed segment as the engine timed it (Remuxer.reportThroughput). */
export type ThroughputSample = {
  token: string;
  generation: number;
  segment: number;
  /** Absent on a generation's first segment, which carries the input seek. */
  produceSeconds?: number;
  segmentSeconds: number;
  /** Segments produced ahead of the last one the player asked for. */
  cushion: number;
  /** The producer slept on its read-ahead cap while making this segment. */
  throttled: boolean;
  thermal: string;
  /** Wall seconds the producer spent blocked on the input while making this segment. */
  readSeconds?: number;
};

/** Share of a segment's wall time spent waiting on the input above which the link, not the engine, set the pace. */
export const READ_BOUND_SHARE = 0.6;

/** The segment took long because its bytes arrived slowly, not because the engine was slow. */
export function readBound(sample: Pick<ThroughputSample, "produceSeconds" | "readSeconds">): boolean {
  return sample.produceSeconds != null && sample.produceSeconds > 0 && sample.readSeconds != null && sample.readSeconds / sample.produceSeconds >= READ_BOUND_SHARE;
}

/** A segment that took longer to make than it plays. An untimed sample is not slow. */
export function belowRealtime(sample: Pick<ThroughputSample, "produceSeconds" | "segmentSeconds">): boolean {
  return sample.produceSeconds != null && sample.produceSeconds > sample.segmentSeconds;
}

/**
 * The engine is losing: its last two timed, unthrottled segments of the current generation
 * ran below realtime, and at most one segment stands between the producer and the player.
 */
export function engineStarving(samples: ThroughputSample[]): boolean {
  const latest = samples.at(-1);
  if (!latest) return false;
  const timed = samples.filter((sample) => sample.generation === latest.generation && !sample.throttled && sample.produceSeconds != null);
  return timed.length >= 2 && latest.cushion <= 1 && timed.slice(-2).every(belowRealtime);
}

/**
 * A live feed is under-delivering: the last three timed segments each arrived slower
 * than they play, each stalled on the read, with nothing buffered ahead. Generations
 * are NOT filtered: an origin this starved rolls one on every dropped connection.
 */
export function liveStarving(samples: ThroughputSample[]): boolean {
  const latest = samples.at(-1);
  if (!latest || latest.cushion > 1) return false;
  const timed = samples.filter((sample) => !sample.throttled && sample.produceSeconds != null);
  return timed.length >= 3 && timed.slice(-3).every((sample) => belowRealtime(sample) && readBound(sample));
}

/** FFmpeg's wording for an HTTP 404 on the input (av_strerror of AVERROR_HTTP_NOT_FOUND). */
export function engineInputMissing(message: string): boolean {
  return /Server returned 404/.test(message);
}
