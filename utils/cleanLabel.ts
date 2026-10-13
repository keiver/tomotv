import { decodeHTML } from "entities";

/**
 * Drops every "<...>" span in one linear pass. A "<" with no ">" after it is kept, with
 * everything after it.
 */
export function stripTags(text: string): string {
  let out = "";
  let from = 0;
  for (;;) {
    const open = text.indexOf("<", from);
    const close = open < 0 ? -1 : text.indexOf(">", open + 1);
    if (close < 0) return out + text.slice(from);
    out += text.slice(from, open);
    from = close + 1;
  }
}

/**
 * Display cleanup for server-written labels (titles, names): scrapers store HTML-escaped
 * text, so entities decode. Tags come off before AND after, since "&lt;b&gt;" decodes
 * into real markup a future consumer might interpret.
 */
export function cleanLabel(text: string | null | undefined): string {
  if (!text) return "";
  if (!text.includes("&") && !text.includes("<")) return text;
  return stripTags(decodeHTML(stripTags(text)));
}
