import { COLORS } from "@/constants/colors";
import { useItemPoster } from "@/hooks/useItemPoster";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import { Image } from "expo-image";
import React from "react";
import { Platform, StyleSheet, View } from "react-native";

const IS_TV = Platform.isTV;
/** How far each layer shows past the right edge of the one in front of it. */
export const STACK_STEP = IS_TV ? 16 : 8;
/** How far in from the top and bottom a layer sits per step behind the front. */
const STACK_INSET_PERCENT = 7;
const STACK_DIM_PER_STEP = 0.28;

interface PosterStackProps {
  /** The folder's first videos, front first. */
  items: JellyfinVideoItem[];
  height: number;
}

/**
 * A folder's first videos layered inside its card: the front one on the left edge, each one
 * behind shorter and peeking out of the right edge. The top stays clear for the count pill.
 * One video is one frame filling the slot; the stack never claims more than the folder holds.
 */
export function PosterStack({ items, height }: PosterStackProps) {
  const depth = items.length;
  return (
    <View style={styles.stack} pointerEvents="none">
      {items.map((item, behind) => <StackLayer key={item.Id} item={item} height={height} behind={behind} right={(depth - 1 - behind) * STACK_STEP} />).reverse()}
    </View>
  );
}

function StackLayer({ item, height, behind, right }: { item: JellyfinVideoItem; height: number; behind: number; right: number }) {
  const source = useItemPoster(item, height);
  const inset = `${behind * STACK_INSET_PERCENT}%` as const;
  return (
    <View style={[styles.layer, { right, top: inset, bottom: inset }]} testID={`poster-stack-layer-${behind}`}>
      {source ? <Image source={source} style={styles.art} contentFit="cover" transition={0} cachePolicy="memory-disk" recyclingKey={item.Id} /> : null}
      {behind > 0 ? <View style={[styles.dim, { opacity: Math.min(1, behind * STACK_DIM_PER_STEP) }]} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    width: "100%",
    height: "100%",
  },
  // A hairline keeps two similar frames apart where they overlap; the fill shows until the frame lands.
  layer: {
    position: "absolute",
    left: 0,
    borderTopRightRadius: IS_TV ? 10 : 6,
    borderBottomRightRadius: IS_TV ? 10 : 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.16)",
    overflow: "hidden",
    backgroundColor: COLORS.SURFACE_RAISED,
  },
  art: {
    width: "100%",
    height: "100%",
  },
  dim: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#000",
  },
});
