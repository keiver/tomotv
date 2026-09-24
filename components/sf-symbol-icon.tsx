import { Image } from "expo-image";
import React from "react";

interface SfSymbolIconProps {
  /** An SF Symbol name; expo-image draws it through UIImage(systemName:). */
  name: string;
  size: number;
  color: string;
}

/** The platform's own glyph where Ionicons has no counterpart, on iOS and tvOS alike. */
export function SfSymbolIcon({ name, size, color }: SfSymbolIconProps) {
  return <Image source={`sf:${name}`} style={{ width: size, height: size }} tintColor={color} contentFit="contain" accessible={false} />;
}
