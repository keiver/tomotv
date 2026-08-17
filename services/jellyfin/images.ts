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
 * Full-resolution Backdrop artwork (the 16:9 art detail pages use), for the theater
 * background. `tag` pins the exact image version for stable caching when known.
 */
export function getBackdropUrl(itemId: string, tag?: string): string {
  if (!getCachedConfig().server || !getCachedConfig().apiKey) {
    return "";
  }
  const tagParam = tag ? `&tag=${tag}` : "";
  return `${getCachedConfig().server}/Items/${itemId}/Images/Backdrop/0?ApiKey=${getCachedConfig().apiKey}&maxWidth=1920&quality=80${tagParam}`;
}

/**
 * Check if item has a poster image
 */
export function hasPoster(item: JellyfinVideoItem): boolean {
  return item.ImageTags?.Primary !== undefined;
}
