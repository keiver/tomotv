/**
 * The viewer's own OpenSubtitles sign-in, kept in the keychain. It is optional: the app's own key
 * searches and downloads without it, and a download signs in with it when both fields are filled.
 */
import * as SecureStore from "expo-secure-store";
import { NO_KEYS, type OwnKeys } from "./types";

export const SUBTITLE_KEY_STORAGE = {
  OPENSUBTITLES_USERNAME: "subtitles_opensubtitles_username",
  OPENSUBTITLES_PASSWORD: "subtitles_opensubtitles_password",
} as const;

export type SubtitleKeyName = keyof typeof SUBTITLE_KEY_STORAGE;

async function read(name: SubtitleKeyName): Promise<string> {
  try {
    return ((await SecureStore.getItemAsync(SUBTITLE_KEY_STORAGE[name])) ?? "").trim();
  } catch {
    return "";
  }
}

/** The kept sign-in, left null while either field is empty. */
export async function readOwnKeys(): Promise<OwnKeys> {
  const [username, password] = await Promise.all([read("OPENSUBTITLES_USERNAME"), read("OPENSUBTITLES_PASSWORD")]);
  return {
    ...NO_KEYS,
    opensubtitles: username && password ? { username, password } : null,
  };
}

/** Writes one field; an empty value removes it. */
export async function writeOwnKey(name: SubtitleKeyName, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) await SecureStore.setItemAsync(SUBTITLE_KEY_STORAGE[name], trimmed);
  else await SecureStore.deleteItemAsync(SUBTITLE_KEY_STORAGE[name]);
}

/** The stored value of one field, for a settings screen to show. */
export async function readOwnKey(name: SubtitleKeyName): Promise<string> {
  return read(name);
}
