/**
 * Synchronous image URL builders. All of them read the credential snapshot rather than
 * awaiting config, so they can be called straight from render; each returns "" when the
 * session is still cold, which renders as no image instead of a broken request.
 */
import { JellyfinVideoItem } from "@/types/jellyfin";
import { getCachedConfig } from "./session";

/**
 * Get thumbnail URL for a folder
 * Returns empty string if config not yet loaded (prevents broken image requests)
 */
export function getFolderThumbnailUrl(itemId: string, maxHeight: number = 300): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Items/${itemId}/Images/Primary?ApiKey=${getCachedConfig().apiKey}&maxHeight=${maxHeight}&quality=90`;
}

/**
 * Get poster image URL for a specific item
 * Posters are better for movie/video displays (2:3 aspect ratio)
 * Returns empty string if config not yet loaded (prevents broken image requests)
 */
export function getPosterUrl(itemId: string, maxHeight: number = 450): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Items/${itemId}/Images/Primary?ApiKey=${getCachedConfig().apiKey}&maxHeight=${maxHeight}&quality=90`;
}

/**
 * A chapter's keyframe: the server extracts one per chapter only where the library's
 * chapter image extraction is on (Chapters[].ImageTag). Index is the chapter's position.
 */
export function getChapterImageUrl(itemId: string, chapterIndex: number, imageTag: string, maxWidth: number = 480): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Items/${itemId}/Images/Chapter/${chapterIndex}?ApiKey=${getCachedConfig().apiKey}&maxWidth=${maxWidth}&quality=90&tag=${imageTag}`;
}

/**
 * Get a full-screen image URL for a Photo item (the Primary image IS the photo)
 * Width is capped at 4K so multi-megapixel originals don't stall the Apple TV
 * Returns empty string if config not yet loaded (prevents broken image requests)
 */
export function getPhotoUrl(itemId: string, maxWidth: number = 3840): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Items/${itemId}/Images/Primary?ApiKey=${getCachedConfig().apiKey}&maxWidth=${maxWidth}&quality=90`;
}

/**
 * Get a tiny, server-blurred poster URL for use as an ambient background wash.
 * The image is requested small (48px tall) and upscaled full-screen by the renderer,
 * which is what produces the soft blur, so no client-side blur pass is needed. The optional
 * imageTag only matters for the stable cacheKey the caller builds; it isn't in the URL.
 */
export function getBackdropBlurUrl(itemId: string): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Items/${itemId}/Images/Primary?ApiKey=${getCachedConfig().apiKey}&maxHeight=48&quality=60&blur=20`;
}

/**
 * The original file behind a Photo item, byte for byte. The Images/Primary URL above is a
 * display copy the server may re-encode.
 */
export function getPhotoFileUrl(itemId: string): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Items/${itemId}/Download?ApiKey=${getCachedConfig().apiKey}`;
}

/**
 * Check if item has a poster image
 */
export function hasPoster(item: Pick<JellyfinVideoItem, "ImageTags">): boolean {
  return item.ImageTags?.Primary !== undefined;
}

/**
 * Get the real backdrop (fanart) image URL. Gate on BackdropImageTags length —
 * requesting index 0 on an item without one is a 404.
 */
export function getBackdropUrl(itemId: string, maxWidth: number = 1920): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Items/${itemId}/Images/Backdrop/0?ApiKey=${getCachedConfig().apiKey}&maxWidth=${maxWidth}&quality=90`;
}

/**
 * Get the title logo art URL (transparent PNG). Gate on ImageTags.Logo.
 *
 * Pass that tag: it is a content hash, so replacing the artwork server-side changes the URL
 * and the cached bitmap is not served in its place.
 */
export function getLogoUrl(itemId: string, maxHeight: number = 200, imageTag?: string): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  const tag = imageTag ? `&tag=${imageTag}` : "";
  return `${getCachedConfig().server}/Items/${itemId}/Images/Logo?ApiKey=${getCachedConfig().apiKey}&maxHeight=${maxHeight}&quality=90${tag}`;
}

/**
 * Get a cast member's headshot URL (a person is an item; its Primary image is the headshot).
 * Gate on the person's PrimaryImageTag.
 */
export function getPersonImageUrl(personId: string, maxHeight: number = 300): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  return `${getCachedConfig().server}/Items/${personId}/Images/Primary?ApiKey=${getCachedConfig().apiKey}&maxHeight=${maxHeight}&quality=90`;
}
