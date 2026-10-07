import React from "react";
import { Pressable, StyleSheet, View } from "react-native";

interface SiblingEdgesProps {
  onPrevious?: () => void;
  onNext?: () => void;
}

/**
 * tvOS: an invisible focus stop down each side of the screen, in the gutter beside the centred card.
 * The focus engine reaches one only when nothing in the card lies further that way.
 */
export function SiblingEdges({ onPrevious, onNext }: SiblingEdgesProps) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {onPrevious && <Pressable testID="sibling-edge-previous" isTVSelectable onFocus={onPrevious} style={[styles.edge, styles.left]} tvParallaxProperties={{ enabled: false }} />}
      {onNext && <Pressable testID="sibling-edge-next" isTVSelectable onFocus={onNext} style={[styles.edge, styles.right]} tvParallaxProperties={{ enabled: false }} />}
    </View>
  );
}

const styles = StyleSheet.create({
  edge: {
    position: "absolute",
    top: 0,
    bottom: 0,
    width: 60,
  },
  left: {
    left: 0,
  },
  right: {
    right: 0,
  },
});
