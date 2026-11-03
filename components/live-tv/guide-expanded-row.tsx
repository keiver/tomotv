import React from "react";
import Animated, { type SharedValue, useAnimatedStyle } from "react-native-reanimated";

interface GuideExpandedRowProps {
  /** 0 closed, 1 open. */
  open: SharedValue<number>;
  rowHeight: number;
  extra: number;
  children: React.ReactNode;
}

/** The row that holds the Live TV player: its usual content on top, grown by `extra` as it opens, in both lists alike. */
export function GuideExpandedRow({ open, rowHeight, extra, children }: GuideExpandedRowProps) {
  const heightStyle = useAnimatedStyle(() => ({ height: rowHeight + open.get() * extra }));
  return <Animated.View style={heightStyle}>{children}</Animated.View>;
}
