/**
 * Subtitle text to WebVTT, which is the one format the engine serves and AVPlayer draws. SRT keeps
 * its cues; ASS and SSA keep their dialogue text and lose their styling.
 */

export const TEXT_FORMATS: readonly string[] = ["srt", "vtt", "ass", "ssa", "sub"];

/** The extension of a subtitle file name, lower case, or "" when it has none. */
export function formatOf(fileName: string): string {
  const match = fileName.match(/\.([A-Za-z0-9]+)$/);
  return match ? match[1].toLowerCase() : "";
}

/** Which format a text is in when its name does not say: WebVTT by its header, ASS by its sections, else SRT. */
export function sniffFormat(text: string): string {
  const head = text.replace(/^﻿/, "").trimStart();
  if (/^WEBVTT/.test(head)) return "vtt";
  if (/^\[Script Info\]/im.test(head) || /^\[Events\]/im.test(head)) return "ass";
  return "srt";
}

const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/g;

function srtToVtt(text: string): string {
  const body = text
    .replace(/^﻿/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => (/-->/.test(line) ? line.replace(SRT_TIME, (_, h, m, s, ms) => `${h.padStart(2, "0")}:${m}:${s}.${ms.padEnd(3, "0")}`) : line.replace(/\{\\[^}]*\}/g, "")))
    .join("\n")
    .trim();
  return `WEBVTT\n\n${body}\n`;
}

/** h:mm:ss.cc as ASS writes it, to hh:mm:ss.mmm. */
function assTime(value: string): string {
  const match = value.trim().match(/^(\d+):(\d{2}):(\d{2})[.:](\d{2})$/);
  if (!match) return "00:00:00.000";
  return `${match[1].padStart(2, "0")}:${match[2]}:${match[3]}.${match[4]}0`;
}

function assToVtt(text: string): string {
  const lines = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  let fields: string[] = [];
  const cues: { start: string; end: string; text: string }[] = [];
  for (const line of lines) {
    if (/^Format:/i.test(line)) {
      fields = line
        .slice(7)
        .split(",")
        .map((field) => field.trim().toLowerCase());
      continue;
    }
    if (!/^Dialogue:/i.test(line) || fields.length === 0) continue;
    const parts = line.slice(9).split(",");
    const textIndex = fields.indexOf("text");
    if (textIndex < 0) continue;
    const start = parts[fields.indexOf("start")];
    const end = parts[fields.indexOf("end")];
    const dialogue = parts
      .slice(textIndex)
      .join(",")
      .replace(/\{[^}]*\}/g, "")
      .replace(/\\N|\\n/g, "\n")
      .replace(/\\h/g, " ")
      .trim();
    if (!start || !end || !dialogue) continue;
    cues.push({ start: assTime(start), end: assTime(end), text: dialogue });
  }
  cues.sort((a, b) => a.start.localeCompare(b.start));
  return `WEBVTT\n\n${cues.map((cue) => `${cue.start} --> ${cue.end}\n${cue.text}`).join("\n\n")}\n`;
}

/** The WebVTT for a subtitle text, or null for a format this app cannot read. */
export function toWebVtt(text: string, format: string): string | null {
  const kind = format || sniffFormat(text);
  switch (kind) {
    case "vtt":
      return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    case "srt":
    case "sub":
      return srtToVtt(text);
    case "ass":
    case "ssa":
      return assToVtt(text);
    default:
      return null;
  }
}

/** Whether a WebVTT text carries at least one timed cue. */
export function hasCues(vtt: string): boolean {
  return /\d{2}:\d{2}[:.]\d{2,3}.*-->/.test(vtt);
}
