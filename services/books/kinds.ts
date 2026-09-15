/**
 * Which reader a Book item needs. Jellyfin 12 leaves `Container` empty on books, so the
 * file extension in `Path` is the only signal.
 */
/** Pages are pictures already: comics and PDFs. */
export const FIXED_BOOK_EXTENSIONS = ["pdf", "cbz", "cbr", "cbt", "cb7"] as const;
/** Pages are laid out from text at a font size. */
export const TEXT_BOOK_EXTENSIONS = ["epub", "mobi", "azw", "azw3", "prc"] as const;

export type BookKind = "fixed" | "text";

export function bookExtension(item: { Path?: string | null; Container?: string | null }): string {
  const name = item.Path?.split(/[/\\]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  const fromPath = dot > 0 ? name.slice(dot + 1) : "";
  return (fromPath || item.Container || "").toLowerCase();
}

export function bookKind(item: { Path?: string | null; Container?: string | null }): BookKind | null {
  const ext = bookExtension(item);
  if ((FIXED_BOOK_EXTENSIONS as readonly string[]).includes(ext)) return "fixed";
  if ((TEXT_BOOK_EXTENSIONS as readonly string[]).includes(ext)) return "text";
  return null;
}
