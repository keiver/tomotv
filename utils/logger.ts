/**
 * Structured logging utility for TomoTV
 * Provides consistent logging with levels, timestamps, and context
 *
 * Usage:
 *   logger.info('User logged in', { userId: '123' })
 *   logger.error('Failed to fetch', error, { context: 'API' })
 *   logger.debug('Processing', { step: 1 })
 */

import Constants from "expo-constants";
import { Platform } from "react-native";

type LogLevel = "debug" | "info" | "warn" | "error";

interface LogContext {
  [key: string]: unknown;
}

/**
 * Check if a value is an Error object
 * More reliable than checking for 'message' property which can exist on regular objects
 */
function isErrorObject(value: unknown): value is Error {
  return value instanceof Error || (typeof value === "object" && value !== null && "stack" in value && typeof (value as Error).stack === "string");
}

/**
 * Strips the Jellyfin access token out of anything logged.
 *
 * This used to live at a single call site in services/jellyfin/streamUrls.ts,
 * which left every other place a stream URL reaches a log one oversight away from
 * printing the key. Doing it here makes the guarantee structural: a URL cannot be
 * logged with its token intact, whoever writes the call.
 *
 * Covers the current `ApiKey` spelling, the legacy `api_key` one, and the
 * `Token="…"` form of the MediaBrowser authorization header
 * (services/jellyfin/session.ts getAuthHeader).
 */
const API_KEY_PATTERN = /([Aa]pi_?[Kk]ey=)[^&\s"']+/g;
const AUTH_TOKEN_PATTERN = /(Token=")[^"]*/g;

export function redactSecrets(value: string): string {
  return value.replace(API_KEY_PATTERN, "$1[redacted]").replace(AUTH_TOKEN_PATTERN, "$1[redacted]");
}

/**
 * Redacts the `error` argument, which used to print verbatim and was the one
 * path into this module that skipped redaction entirely.
 *
 * Errors become a plain {name, message, stack}: reconstructing an Error would
 * drop the subclass and any extra fields, and mutating the caller's own object
 * is worse. Those three are what console printed of it anyway.
 */
function redactError(value: unknown): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (!isErrorObject(value)) return redactContext(value);
  const redacted: { name: string; message: string; stack?: string } = {
    name: value.name ?? "Error",
    message: redactSecrets(value.message ?? ""),
  };
  if (typeof value.stack === "string") redacted.stack = redactSecrets(value.stack);
  return redacted;
}

/** Recursively redacts string values in a log context, arrays and nesting included. */
function redactContext(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (depth >= 4 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redactContext(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactContext(v, depth + 1);
  return out;
}

/**
 * Who wrote the line. Metro merges every connected device into one stream, so an Apple TV
 * and an iPhone interleave with nothing to tell them apart — two sessions reporting to the
 * same server read as one session contradicting itself. The trailing id is expo-constants'
 * per-launch sessionId, which separates reloads of the same device. Both fields are
 * optional-guarded: the jest mock stubs expo-constants down to expoConfig alone.
 */
const DEVICE_TAG = `${Platform.isTV ? "tvOS" : Platform.OS} ${Constants.deviceName ?? "device"} ${Constants.sessionId?.slice(0, 4) ?? "----"}`;

class Logger {
  private isDevelopment: boolean;
  private minLevel: LogLevel;

  constructor() {
    this.isDevelopment = __DEV__;
    // In production, only log warnings and errors
    this.minLevel = this.isDevelopment ? "debug" : "warn";
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    const currentLevelIndex = levels.indexOf(level);
    const minLevelIndex = levels.indexOf(this.minLevel);
    return currentLevelIndex >= minLevelIndex;
  }

  private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
    const timestamp = new Date().toISOString();
    const levelUpper = level.toUpperCase().padEnd(5);

    let formattedMessage = `[${timestamp}] [${DEVICE_TAG}] ${levelUpper} ${redactSecrets(message)}`;

    if (context && Object.keys(context).length > 0) {
      formattedMessage += ` ${JSON.stringify(redactContext(context))}`;
    }

    return formattedMessage;
  }

  private log(level: LogLevel, message: string, error?: Error | unknown, context?: LogContext): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const formattedMessage = this.formatMessage(level, message, context);
    // Guarded on the original so a falsy error still prints nothing, exactly as before.
    const safeError = error ? redactError(error) : undefined;

    switch (level) {
      case "debug":
      case "info":
        console.log(formattedMessage);
        if (error) {
          console.log(safeError);
        }
        break;
      case "warn":
        console.warn(formattedMessage);
        if (error) {
          console.warn(safeError);
        }
        break;
      case "error":
        console.error(formattedMessage);
        if (error) {
          console.error(safeError);
        }
        break;
    }
  }

  /**
   * Log debug information (only in development)
   */
  debug(message: string, context?: LogContext): void {
    this.log("debug", message, undefined, context);
  }

  /**
   * Log informational messages
   * @overload info(message, context) - Log with context only
   * @overload info(message, error, context) - Log with error and optional context
   */
  info(message: string, errorOrContext?: Error | LogContext | unknown, context?: LogContext): void {
    // Use isErrorObject for reliable detection - checks for 'stack' property
    // which is more reliable than 'message' (which regular objects may have)
    if (isErrorObject(errorOrContext)) {
      this.log("info", message, errorOrContext, context);
    } else if (errorOrContext && typeof errorOrContext === "object" && !isErrorObject(errorOrContext)) {
      this.log("info", message, undefined, errorOrContext as LogContext);
    } else {
      this.log("info", message, errorOrContext, context);
    }
  }

  /**
   * Log warning messages
   * @overload warn(message, context) - Log with context only
   * @overload warn(message, error, context) - Log with error and optional context
   */
  warn(message: string, errorOrContext?: Error | LogContext | unknown, context?: LogContext): void {
    // Use isErrorObject for reliable detection - checks for 'stack' property
    if (isErrorObject(errorOrContext)) {
      this.log("warn", message, errorOrContext, context);
    } else if (errorOrContext && typeof errorOrContext === "object" && !isErrorObject(errorOrContext)) {
      this.log("warn", message, undefined, errorOrContext as LogContext);
    } else {
      this.log("warn", message, errorOrContext, context);
    }
  }

  /**
   * Log error messages with optional error object
   */
  error(message: string, error?: Error | unknown, context?: LogContext): void {
    this.log("error", message, error, context);
  }
}

// Export singleton instance
export const logger = new Logger();
