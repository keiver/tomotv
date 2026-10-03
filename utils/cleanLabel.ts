import { decodeHTML } from "entities";

/** Complete tags only; text after a lone "<" with no closing ">" is kept. */
const ANY_TAG = /<[^>]*>/g;

/**
 * Display cleanup for server-written labels (titles, names): scrapers store HTML-escaped
 * text, so entities decode. Tags come off before AND after, since "&lt;b&gt;" decodes
 * into real markup a future consumer might interpret.
 */
export function cleanLabel(text: string | null | undefined): string {
  if (!text) return "";
  if (!text.includes("&") && !text.includes("<")) return text;
  return decodeHTML(text.replace(ANY_TAG, "")).replace(ANY_TAG, "");
}
