import { JellyfinItem } from "@/types/jellyfin";

/** The episode after the last watched one in list order, the card the binge plays next; null before the first is watched or once all are. */
export function bingeNextId(items: Pick<JellyfinItem, "Id" | "Type" | "UserData">[]): string | null {
  let anchor = -1;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].Type === "Episode" && items[i].UserData?.Played) {
      anchor = i;
      break;
    }
  }
  if (anchor < 0) return null;
  for (let i = anchor + 1; i < items.length; i++) {
    if (items[i].Type === "Episode" && !items[i].UserData?.Played) return items[i].Id;
  }
  return null;
}
