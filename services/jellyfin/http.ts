/**
 * The request-timeout block, written once.
 *
 * Every read in this folder used to transcribe the same seven lines: build an
 * AbortController, arm a setTimeout, pass the signal, then clear the timer on both the
 * success and the failure path. Thirty copies, sixty clearTimeout calls, and one place
 * (fetchVideoDetails) that needed a hoisted `let` just to clear a second timer from a
 * shared catch.
 *
 * Deliberately narrow: this owns the timer and nothing else. Status handling, error
 * wording and response parsing stay at the call sites, because they genuinely differ at
 * every one of them — a 401 means "session expired" to a data read and "wrong password"
 * to a login, and the exact message text feeds retryWithBackoff's retryability regexes.
 */

/**
 * Fetch under a wall-clock timeout.
 *
 * The timer is cleared in a `finally`, so every exit path is covered by construction
 * rather than by remembering to write `clearTimeout` in each branch.
 *
 * The budget covers the response BODY: the app runs React Native's fetch
 * (EXPO_PUBLIC_USE_RN_FETCH in .env), which resolves once the whole body has arrived.
 *
 * @param timeoutMessage Optional replacement for the raw AbortError when the timeout
 *   fires. Callers that had their own AbortError conversion pass their exact previous
 *   string; callers that had none pass nothing and the AbortError propagates unchanged.
 *   Do not add one where a call site did not have one: `utils/retry.ts` classifies
 *   retryability by matching the message, so the wording is behaviour.
 */
export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number, timeoutMessage?: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timeoutMessage && error instanceof Error && error.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
