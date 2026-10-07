import { type Hsb, hsbToHex } from "@/utils/color";

/** Each slider's track: the colours its channel runs through with the other two held. */
export function hueGradient(): string {
  const stops = [0, 60, 120, 180, 240, 300, 360].map((h) => hsbToHex({ h, s: 1, b: 1 }));
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

export function saturationGradient({ h, b }: Hsb): string {
  return `linear-gradient(90deg, ${hsbToHex({ h, s: 0, b })}, ${hsbToHex({ h, s: 1, b })})`;
}

export function brightnessGradient({ h, s }: Hsb): string {
  return `linear-gradient(90deg, #000000, ${hsbToHex({ h, s, b: 1 })})`;
}
