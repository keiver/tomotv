import { Image } from "expo-image";
import React from "react";
import type { TextStyle } from "react-native";

interface SfSymbolIconProps {
  /** An SF Symbol name; expo-image draws it through UIImage(systemName:). */
  name: string;
  size: number;
  color: string;
  /** The symbol's stroke weight; defaults to the system's regular. */
  weight?: TextStyle["fontWeight"];
}

/** The platform's own glyph where Ionicons has no counterpart, on iOS and tvOS alike. */
export function SfSymbolIcon({ name, size, color, weight }: SfSymbolIconProps) {
  return <Image source={`sf:${name}`} style={{ width: size, height: size, fontWeight: weight }} tintColor={color} contentFit="contain" accessible={false} />;
}
