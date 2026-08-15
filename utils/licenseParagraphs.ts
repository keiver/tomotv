/**
 * Split a license into reading chunks on blank lines (including whitespace-only
 * ones), trimmed, empties dropped. Trimming also strips the deep indentation the
 * canonical texts use to centre headings, which renders as large blank areas.
 *
 * Shared because both license screens need it for the same reason: on TV each
 * chunk becomes a focus stop so the remote can walk a text longer than one
 * screen. A single non-focusable block gets jumped over row-to-row and cannot be
 * read at all.
 */
export function licenseParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}
