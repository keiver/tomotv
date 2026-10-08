/** What the engine reads for a live channel: the origin's stream, with the headers it requires. */
export interface ChannelOrigin {
  url: string;
  headers?: Record<string, string>;
  /** A raw TS channel: the provider whose connection budget a grab spends, and the server's pass-through. */
  originKey?: string;
  fallbackUrl?: string;
}
