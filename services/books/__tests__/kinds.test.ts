import { bookExtension, bookKind } from "@/services/books/kinds";

describe("book kinds", () => {
  it("reads the kind off the path extension, since Jellyfin 12 leaves Container empty on books", () => {
    expect(bookKind({ Path: "/books/Comic Vol 1.cbz", Container: undefined })).toBe("fixed");
    expect(bookKind({ Path: "/books/Novel.EPUB", Container: undefined })).toBe("text");
    expect(bookKind({ Path: "/books/Frankenstein (KF8).azw3", Container: undefined })).toBe("text");
    expect(bookKind({ Path: "/books/paper.pdf", Container: undefined })).toBe("fixed");
    expect(bookKind({ Path: "/books/scan.cb7", Container: undefined })).toBe("fixed");
  });

  it("falls back to Container when the path carries no extension", () => {
    expect(bookExtension({ Path: "/books/no-extension", Container: "mobi" })).toBe("mobi");
    expect(bookKind({ Path: undefined, Container: "cbr" })).toBe("fixed");
  });

  it("names no reader for other files", () => {
    expect(bookKind({ Path: "/books/notes.txt", Container: undefined })).toBeNull();
    expect(bookKind({ Path: undefined, Container: undefined })).toBeNull();
  });
});
