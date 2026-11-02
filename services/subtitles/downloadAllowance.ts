/**
 * The OpenSubtitles downloads left today, kept across launches and counted on the device: every
 * download takes one, and the provider's own figure replaces the count whenever an answer carries
 * one. A new day restores the daily allowance: 5 on the app key alone, the account's own once a
 * sign-in has said it.
 */
import { Settings } from "react-native";

export const DOWNLOAD_ALLOWANCE_KEY = "opensubtitles_download_allowance";
/** Downloads a day on the app key without a sign-in. */
export const ANONYMOUS_DAILY_DOWNLOADS = 5;

interface Allowance {
  /** The signed-in username, or "" for the app key alone. */
  account: string;
  remaining: number;
  /** What a new day restores. */
  daily: number;
  /** When the provider's day ends, in ms since the epoch. */
  resetsAt: number;
}

/** The account downloads currently go against; null until a download says. */
let current: string | null = null;

export function nextUtcMidnight(now: number): number {
  const date = new Date(now);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
}

function read(): Allowance | null {
  try {
    const raw: unknown = Settings.get(DOWNLOAD_ALLOWANCE_KEY);
    if (typeof raw !== "string") return null;
    const parsed = JSON.parse(raw) as Partial<Allowance>;
    if (typeof parsed.account !== "string" || typeof parsed.remaining !== "number" || typeof parsed.daily !== "number" || typeof parsed.resetsAt !== "number") return null;
    return parsed as Allowance;
  } catch {
    return null;
  }
}

function write(allowance: Allowance): void {
  try {
    Settings.set({ [DOWNLOAD_ALLOWANCE_KEY]: JSON.stringify(allowance) });
  } catch {
    // A count that could not be kept is counted again from the next answer.
  }
}

/** The allowance for the account now in use, rolled into a new day when the stored one ended. Null for an account whose allowance no answer has given yet. */
function allowance(now: number): Allowance | null {
  const stored = read();
  const account = current ?? stored?.account ?? "";
  if (stored && stored.account === account) {
    return now < stored.resetsAt ? stored : { ...stored, remaining: stored.daily, resetsAt: nextUtcMidnight(now) };
  }
  return account === "" ? { account, remaining: ANONYMOUS_DAILY_DOWNLOADS, daily: ANONYMOUS_DAILY_DOWNLOADS, resetsAt: nextUtcMidnight(now) } : null;
}

/** Downloads go against this account from here on: a username, or "" for the app key alone. */
export function setDownloadAccount(account: string): void {
  current = account;
}

/** The downloads left today, or null for a signed-in account no answer has counted yet. */
export function downloadsLeft(now: number = Date.now()): number | null {
  return allowance(now)?.remaining ?? null;
}

/** The provider's own figure: what is left, the daily allowance when it says, and when its day ends. */
export function recordDownloadsLeft(remaining: number, answer: { daily?: number; resetsAt?: number } = {}, now: number = Date.now()): void {
  const known = allowance(now);
  const account = current ?? known?.account ?? "";
  const daily = answer.daily ?? known?.daily ?? Math.max(remaining, account === "" ? ANONYMOUS_DAILY_DOWNLOADS : remaining);
  const resetsAt = answer.resetsAt !== undefined && Number.isFinite(answer.resetsAt) && answer.resetsAt > now ? answer.resetsAt : (known?.resetsAt ?? nextUtcMidnight(now));
  write({ account, remaining: Math.max(0, remaining), daily, resetsAt });
}

/** One download made with no figure in its answer: the count drops by one. */
export function countDownload(now: number = Date.now()): void {
  const known = allowance(now);
  if (!known) return;
  write({ ...known, remaining: Math.max(0, known.remaining - 1) });
}

/** For tests: forget the account in use. */
export function resetDownloadAccount(): void {
  current = null;
}
