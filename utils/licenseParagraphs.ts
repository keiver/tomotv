const MARKER = /^(\(?([a-z]|[ivx]{1,4}|\d{1,3}(\.\d+)*)[.)]|[-*•])\s/i;
const RULER = /^[-=*_~]{3,}$/;
const ENDS_ITEM = /[.:;,*]$/;
const COPYRIGHT_LINE = /^Copyright\s*(\(c\)|©|\d{4}|<)/i;
const COLUMNS = / {3,}/;

/** A line break the text means, as opposed to one the 72-column wrap put there. */
function keepsBreak(prev: string, line: string): boolean {
  if (prev.length < 30) return true;
  if (prev.length < 50 && !/[a-z]/.test(prev)) return true;
  if (RULER.test(prev) || RULER.test(line)) return true;
  if (COLUMNS.test(prev) && COLUMNS.test(line)) return true;
  if (COPYRIGHT_LINE.test(line) || line.startsWith(">")) return true;
  return MARKER.test(line) && ENDS_ITEM.test(prev);
}

/** Unwraps a paragraph's hard-wrapped lines and strips their hang indent; headings, rulers, lists, tables and quotes keep their breaks. */
function reflow(paragraph: string): string {
  const lines = paragraph.split("\n").map((line) => line.trim());
  let out = lines[0];
  for (let i = 1; i < lines.length; i++) out += (keepsBreak(lines[i - 1], lines[i]) ? "\n" : " ") + lines[i];
  return out;
}

/**
 * Split a license into reading chunks on blank lines, each reflowed. Shared by both license
 * screens: on TV each chunk is a focus stop so the remote can walk a text longer than one screen.
 */
export function licenseParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => reflow(paragraph.trim()))
    .filter((paragraph) => paragraph.length > 0);
}
