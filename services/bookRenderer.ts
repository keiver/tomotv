/**
 * bookRenderer.ts
 *
 * Service for the on-device page renderer (native/ios/BookRenderer): a book file in, page
 * images out. Every page the reader shows is a JPEG the module wrote into Caches.
 */
import { NativeModules, Platform } from "react-native";
import type { BookKind } from "@/services/books/kinds";

const { BookRenderer } = NativeModules;

export interface OpenedBook {
  token: string;
  kind: BookKind;
  pages: number;
  title: string | null;
}

export interface RenderedPage {
  uri: string;
  width: number;
  height: number;
}

export interface BookLayout {
  /** Viewport in points. */
  pageWidth: number;
  pageHeight: number;
  /** Device pixel ratio. */
  scale: number;
  /** Text books only. */
  fontSize: number;
}

export function isBookRendererAvailable(): boolean {
  return Platform.OS === "ios" && !!BookRenderer?.openBook;
}

export async function openBook(path: string, layout: BookLayout): Promise<OpenedBook> {
  const result = (await BookRenderer.openBook({ path, ...layout })) as Partial<OpenedBook> | null;
  if (!result || typeof result.token !== "string" || typeof result.pages !== "number" || (result.kind !== "fixed" && result.kind !== "text")) {
    throw new Error("The book renderer returned no book.");
  }
  return { token: result.token, kind: result.kind, pages: result.pages, title: typeof result.title === "string" ? result.title : null };
}

/** `zoom` 1..3 renders a sharper file for a zoomed-in view; archive pages ignore it. */
export async function renderPage(token: string, index: number, zoom: number, layout: BookLayout): Promise<RenderedPage> {
  const result = (await BookRenderer.renderPage({ token, index, zoom, scale: layout.scale, pageWidth: layout.pageWidth, pageHeight: layout.pageHeight })) as Partial<RenderedPage> | null;
  if (!result || typeof result.uri !== "string") throw new Error(`Page ${index + 1} did not render.`);
  return { uri: result.uri, width: result.width ?? 0, height: result.height ?? 0 };
}

/** Text books after a rotation or a font step: the new page count and the page holding the old place. */
export async function relayoutBook(token: string, page: number, layout: BookLayout): Promise<{ pages: number; page: number }> {
  const result = (await BookRenderer.relayoutBook({ token, page, ...layout })) as { pages?: number; page?: number } | null;
  if (!result || typeof result.pages !== "number") throw new Error("The book did not relayout.");
  return { pages: result.pages, page: result.page ?? 0 };
}

export async function closeBook(token: string): Promise<void> {
  if (!isBookRendererAvailable()) return;
  await BookRenderer.closeBook(token);
}
