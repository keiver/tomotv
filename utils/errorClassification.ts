/**
 * errorClassification.ts
 *
 * Pattern-based classification of playback and data-load errors into stable
 * types, plus user-facing message mapping. Lives in utils/ (not the player
 * hook) so services and hooks can both use it: raw fetch/AVPlayer errors carry
 * native exception text and source filenames that must never reach a screen.
 */

/**
 * Error types for video playback classification
 * Using specific patterns instead of loose string matching
 */
export enum PlaybackErrorType {
  NOT_FOUND = "NOT_FOUND",
  UNAUTHORIZED = "UNAUTHORIZED",
  NETWORK = "NETWORK",
  TIMEOUT = "TIMEOUT",
  CORRUPT = "CORRUPT",
  DECODE = "DECODE",
  UNKNOWN = "UNKNOWN",
}

// Patterns for classifying errors - order matters (more specific first)
const ERROR_PATTERNS: { type: PlaybackErrorType; patterns: RegExp[] }[] = [
  {
    type: PlaybackErrorType.NOT_FOUND,
    patterns: [/not found/i, /404/i, /item.*not.*exist/i],
  },
  {
    type: PlaybackErrorType.UNAUTHORIZED,
    patterns: [
      /unauthorized/i,
      /401/i,
      /not authorized/i,
      /authentication.*fail/i,
      /invalid.*credentials/i,
      /error -1013/i, // NSURLErrorResourceUnavailable (often indicates 401/403)
    ],
  },
  {
    type: PlaybackErrorType.TIMEOUT,
    patterns: [/timed?\s*out/i, /timeout/i, /etimedout/i, /\babort/i, /cancell?ed/i],
  },
  {
    type: PlaybackErrorType.CORRUPT,
    patterns: [/HostFunction/i, /corrupted/i, /invalid.*format/i, /invalid.*data/i],
  },
  {
    type: PlaybackErrorType.DECODE,
    patterns: [/decode/i, /codec.*not.*supported/i, /unable.*play/i],
  },
  {
    type: PlaybackErrorType.NETWORK,
    patterns: [/network\s*(error|fail|issue)/i, /fetch\s*(error|fail)/i, /connection\s*(refused|reset|closed)/i, /econnreset/i, /econnrefused/i, /unable.*connect/i, /could\s*not\s*connect/i],
  },
];

/**
 * Classifies an error into a specific type using pattern matching
 * More reliable than loose includes() checks
 */
export function classifyPlaybackError(error: unknown): PlaybackErrorType {
  if (!error) return PlaybackErrorType.UNKNOWN;

  // Native AVPlayer: CoreMediaErrorDomain -12971 = failed to parse segment
  if (typeof error === "object" && error !== null && "code" in error && "domain" in error) {
    const native = error as { code: number; domain: string };
    if (native.code === -12971 && native.domain === "CoreMediaErrorDomain") return PlaybackErrorType.DECODE;
  }

  // Extract error message, preferring localizedDescription for native AVPlayer errors
  let errorMessage: string;
  if (error instanceof Error) {
    errorMessage = error.message;
  } else if (typeof error === "object" && error !== null) {
    const obj = error as Record<string, unknown>;
    errorMessage = String(obj.localizedDescription ?? obj.message ?? "");
  } else {
    errorMessage = String(error);
  }

  for (const { type, patterns } of ERROR_PATTERNS) {
    if (patterns.some((pattern) => pattern.test(errorMessage))) {
      return type;
    }
  }

  return PlaybackErrorType.UNKNOWN;
}

/**
 * Gets a user-friendly error message based on error type
 */
export function getPlaybackErrorMessage(errorType: PlaybackErrorType): string {
  switch (errorType) {
    case PlaybackErrorType.NOT_FOUND:
      return "Video not found on server";
    case PlaybackErrorType.UNAUTHORIZED:
      return "Authentication failed. Your session may have expired.";
    case PlaybackErrorType.NETWORK:
      return "Unable to connect to Jellyfin server";
    case PlaybackErrorType.TIMEOUT:
      return "Connection timed out. Please check your network";
    case PlaybackErrorType.CORRUPT:
      return "This video file appears to be corrupted or in an unsupported format";
    case PlaybackErrorType.DECODE:
      return "Unable to decode video. Try a different quality setting";
    case PlaybackErrorType.UNKNOWN:
    default:
      return "Failed to load video";
  }
}

/** True when the error looks like the server being unreachable (vs. a data problem). */
export function isConnectivityError(error: unknown): boolean {
  const type = classifyPlaybackError(error);
  return type === PlaybackErrorType.NETWORK || type === PlaybackErrorType.TIMEOUT;
}

/**
 * User-facing message for data-load failures (library, search, photos).
 * Same classification as playback, worded for browsing instead of video.
 */
export function getLoadErrorMessage(error: unknown): string {
  switch (classifyPlaybackError(error)) {
    case PlaybackErrorType.NETWORK:
      return "Unable to connect to your Jellyfin server";
    case PlaybackErrorType.TIMEOUT:
      return "Connection timed out. Check your network.";
    case PlaybackErrorType.UNAUTHORIZED:
      return "Authentication failed. Your session may have expired.";
    case PlaybackErrorType.NOT_FOUND:
      return "The server couldn't find this content";
    default:
      return "Something went wrong loading your library";
  }
}
