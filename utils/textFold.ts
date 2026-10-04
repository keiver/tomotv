/** Unicode's Combining Diacritical Marks block, U+0300 to U+036F: what NFD splits off a letter. */
const isCombiningMark = (char: string): boolean => char.charCodeAt(0) >= 0x300 && char.charCodeAt(0) <= 0x36f;

/** Text as a search compares it: trimmed, lower case, accents and other combining marks dropped. */
export function foldText(value: string): string {
  return Array.from(value.normalize("NFD"))
    .filter((char) => !isCombiningMark(char))
    .join("")
    .toLowerCase()
    .trim();
}
