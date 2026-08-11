/**
 * Structured logging utility for TomoTV
 * Provides consistent logging with levels, timestamps, and context
 *
 * Usage:
 *   logger.info('User logged in', { userId: '123' })
 *   logger.error('Failed to fetch', error, { context: 'API' })
 *   logger.debug('Processing', { step: 1 })
 */

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
 * Matches the current `ApiKey` spelling and the legacy `api_key` one, so URLs
 * built by older code are covered too.
 */
const API_KEY_PATTERN = /([Aa]pi_?[Kk]ey=)[^&\s"']+/g;

export function redactSecrets(value: string): string {
  return value.replace(API_KEY_PATTERN, "$1[redacted]");
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

    let formattedMessage = `[${timestamp}] ${levelUpper} ${redactSecrets(message)}`;

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

    switch (level) {
      case "debug":
      case "info":
        console.log(formattedMessage);
        if (error) {
          console.log(error);
        }
        break;
      case "warn":
        console.warn(formattedMessage);
        if (error) {
          console.warn(error);
        }
        break;
      case "error":
        console.error(formattedMessage);
        if (error) {
          console.error(error);
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
