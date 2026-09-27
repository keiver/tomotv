import { TRAILING_SIZE } from "@/components/settings/ListRow";
import { COLORS } from "@/constants/colors";
import { Ionicons } from "@expo/vector-icons";
import React from "react";

/** A list row's chosen mark: green at rest so the choice reads without the row filling; on the gold bar it takes the bar's ink. */
export function tick({ color }: { color: string }) {
  return <Ionicons name="checkmark" size={TRAILING_SIZE} color={color === COLORS.TEXT_TERTIARY ? COLORS.SUCCESS : color} />;
}
