/**
 * The viewer's own subtitle provider accounts, kept in the keychain. Tomo holds no key of its own:
 * a source whose field is empty is never asked.
 */
import * as SecureStore from "expo-secure-store";
import { NO_KEYS, type OwnKeys } from "./types";

export const SUBTITLE_KEY_STORAGE = {
  OPENSUBTITLES_API_KEY: "subtitles_opensubtitles_api_key",
  OPENSUBTITLES_USERNAME: "subtitles_opensubtitles_username",
  OPENSUBTITLES_PASSWORD: "subtitles_opensubtitles_password",
  SUBSOURCE_API_KEY: "subtitles_subsource_api_key",
} as const;

export type SubtitleKeyName = keyof typeof SUBTITLE_KEY_STORAGE;

async function read(name: SubtitleKeyName): Promise<string> {
  try {
    return ((await SecureStore.getItemAsync(SUBTITLE_KEY_STORAGE[name])) ?? "").trim();
  } catch {
    return "";
  }
}

/** Every pasted key, with a provider left null while any of its fields is empty. */
export async function readOwnKeys(): Promise<OwnKeys> {
  const [osKey, osUser, osPassword, subsource] = await Promise.all([read("OPENSUBTITLES_API_KEY"), read("OPENSUBTITLES_USERNAME"), read("OPENSUBTITLES_PASSWORD"), read("SUBSOURCE_API_KEY")]);
  return {
    ...NO_KEYS,
    opensubtitles: osKey && osUser && osPassword ? { apiKey: osKey, username: osUser, password: osPassword } : null,
    subsource: subsource || null,
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
