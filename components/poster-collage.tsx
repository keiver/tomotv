import { COLORS } from "@/constants/colors";
import { useItemPoster } from "@/hooks/useItemPoster";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { Image } from "expo-image";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;
/** The gutter between two cells. */
export const COLLAGE_GAP = IS_TV ? 4 : 2;

interface PosterCollageProps {
  /** The folder's first videos: the first takes the top row, the rest share the bottom. */
  items: JellyfinVideoItem[];
  height: number;
}

/**
 * A folder's first videos as a collage inside its card: the first one across the top half,
 * the others side by side across the bottom. One video fills the card alone.
 */
export function PosterCollage({ items, height }: PosterCollageProps) {
  const [hero, ...rest] = items;
  if (!hero) return null;
  return (
    <View style={styles.collage} pointerEvents="none">
      <Cell item={hero} height={height} />
      {rest.length > 0 ? (
        <View style={styles.row}>
          {rest.map((item) => (
            <Cell key={item.Id} item={item} height={height} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Cell({ item, height }: { item: JellyfinVideoItem; height: number }) {
  const source = useItemPoster(item, height);
  return (
    <View style={styles.cell} testID="poster-collage-cell">
      {source ? <Image source={source} style={styles.art} contentFit="cover" transition={0} cachePolicy="memory-disk" recyclingKey={item.Id} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // The gutter shows the card's own sunken fill, so the cells read as separate frames.
  collage: {
    width: "100%",
    height: "100%",
    gap: COLLAGE_GAP,
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  row: {
    flex: 1,
    flexDirection: "row",
    gap: COLLAGE_GAP,
  },
  // The raised fill shows until the frame lands.
  cell: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: COLORS.SURFACE_RAISED,
  },
  art: {
    width: "100%",
    height: "100%",
  },
});
