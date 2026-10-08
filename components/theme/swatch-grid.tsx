import { COLORS } from "@/constants/colors";
import { cardPalette } from "@/services/cardTheme";
import { normalizeHex } from "@/utils/color";
import { Ionicons } from "@expo/vector-icons";
import React, { useState } from "react";
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";

const IS_TV = Platform.isTV;
const COLUMNS = 5;

/**
 * The hex box, then fourteen colours: three full rows of five. The built-in themes lead (the app's
 * gold, then blue, green and purple, the best-liked colours in YouGov's 10-country survey), then the
 * rest, then a neutral; no two hues within 20 degrees. Each sits at OKLCH lightness 0.80 (gold is 0.85)
 * at its hue's most in-gamut chroma, clearing 5.6:1 on the lightest card title band (#3C3B39).
 */
export const SWATCHES: readonly { name: string; hex: string }[] = [
  { name: "Gold", hex: "#FFC312" },
  { name: "Blue", hex: "#92C0FF" },
  { name: "Green", hex: "#07E442" },
  { name: "Purple", hex: "#C9ACFF" },
  { name: "Red", hex: "#FFA09A" },
  { name: "Orange", hex: "#FFA567" },
  { name: "Teal", hex: "#0FDCBA" },
  { name: "Sky", hex: "#36D0FF" },
  { name: "Indigo", hex: "#B1B6FE" },
  { name: "Magenta", hex: "#EC98FF" },
  { name: "Pink", hex: "#FE95D9" },
  { name: "Lime", hex: "#93D60A" },
  { name: "Rose", hex: "#FF9CB8" },
  { name: "Silver", hex: "#C9CED6" },
];

export function inPalette(hex: string): boolean {
  return SWATCHES.some((swatch) => swatch.hex === hex);
}

interface SwatchGridProps {
  /** The draft colour; its tile wears a tick, or the hex box wears it when it is off the palette. */
  selected: string;
  onPick: (hex: string) => void;
  /** TV: focus on a tile shows its colour on the preview before it is picked. */
  onPreview?: (hex: string) => void;
  /** Focus left the tiles for the hex box: the preview returns to the draft. */
  onHexFocus?: () => void;
  /** The tile focus opens on. Fixed by the host: a preferred focus that moved would pull focus off the sliders. */
  focusHex?: string;
  hexLabel: string;
  /** TV's hex prompt: what to type, and its two buttons. */
  hexHint: string;
  hexCancel: string;
  hexDone: string;
  /** Typed digits that are not a colour. */
  onHexInvalid: (invalid: boolean) => void;
  /** TV: where Up goes from the first row (the Save button's node handle), past anything drawn between. */
  firstRowUp?: number;
}

/** The hex box, then the quick picks: the first tile is the field for a colour the palette has not got. */
export function SwatchGrid({ selected, onPick, onPreview, onHexFocus, focusHex, hexLabel, hexHint, hexCancel, hexDone, onHexInvalid, firstRowUp }: SwatchGridProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [hexFocused, setHexFocused] = useState(false);
  const custom = !inPalette(selected);
  const commit = () => {
    if (draft === null) return;
    const parsed = normalizeHex(draft);
    if (parsed) onPick(parsed);
    onHexInvalid(draft.trim() !== "" && !parsed);
    setDraft(null);
  };
  const promptHex = () =>
    Alert.prompt(
      hexLabel,
      hexHint,
      [
        { text: hexCancel, style: "cancel" },
        {
          text: hexDone,
          onPress: (text?: string) => {
            const parsed = normalizeHex(text ?? "");
            if (parsed) onPick(parsed);
            onHexInvalid((text ?? "").trim() !== "" && !parsed);
          },
        },
      ],
      "plain-text",
      custom ? selected.slice(1) : "",
    );
  const tick = (hex: string) => <Ionicons name="checkmark" size={IS_TV ? 34 : 20} color={cardPalette(hex).ink} />;

  // The hex box is tile 0, so the swatches start one slot in: the first row is its four neighbours.
  const upFrom = (slot: number) => (slot < COLUMNS ? firstRowUp : undefined);

  const swatches = SWATCHES.map(({ name, hex }, index) => (
    <Pressable
      key={hex}
      onPress={() => onPick(hex)}
      onFocus={onPreview ? () => onPreview(hex) : undefined}
      hasTVPreferredFocus={hex === focusHex}
      nextFocusUp={upFrom(index + 1)}
      accessibilityRole="button"
      accessibilityLabel={name}
      accessibilityState={{ selected: hex === selected }}
      style={({ focused }) => [styles.tile, { backgroundColor: hex }, focused && styles.tileFocused]}>
      {hex === selected ? tick(hex) : null}
    </Pressable>
  ));
  const hexBox = IS_TV ? (
    // TV: a plain tile with the palette's own square focus, asking in the system prompt. A text field
    // here would wear UIKit's rounded focus platter, which no TextInput prop turns off.
    <Pressable
      key="hex"
      onPress={promptHex}
      onFocus={onHexFocus}
      nextFocusUp={upFrom(0)}
      accessibilityRole="button"
      accessibilityLabel={hexLabel}
      style={({ focused }) => [styles.tile, styles.hexTile, custom && { backgroundColor: selected }, focused && styles.tileFocused]}>
      <Text style={[styles.hexText, { color: custom ? cardPalette(selected).ink : COLORS.TEXT_SECONDARY }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.6}>
        {custom ? selected : `# ${hexLabel}`}
      </Text>
    </Pressable>
  ) : (
    <View key="hex" style={[styles.tile, styles.hexTile, custom && { backgroundColor: selected }, hexFocused && styles.tileFocused]}>
      <TextInput
        value={draft ?? (custom ? selected : "")}
        onChangeText={setDraft}
        onFocus={() => {
          setHexFocused(true);
          setDraft(custom ? selected.slice(1) : "");
          onHexFocus?.();
        }}
        // A tap elsewhere ends editing too: leaving settles whatever the box holds.
        onBlur={() => {
          setHexFocused(false);
          commit();
        }}
        onEndEditing={commit}
        onSubmitEditing={commit}
        placeholder={`# ${hexLabel}`}
        placeholderTextColor={COLORS.TEXT_SECONDARY}
        selectionColor={COLORS.TEXT_PRIMARY}
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={7}
        returnKeyType="done"
        accessibilityLabel={hexLabel}
        style={[styles.hexInput, { color: custom ? cardPalette(selected).ink : COLORS.TEXT_PRIMARY }]}
      />
    </View>
  );
  // The hex box leads: a colour of your own is the first thing on offer.
  const tiles = [hexBox, ...swatches];

  const rows: React.ReactNode[][] = [];
  for (let i = 0; i < tiles.length; i += COLUMNS) rows.push(tiles.slice(i, i + COLUMNS));
  return (
    <View style={styles.grid} collapsable={false}>
      {rows.map((row, index) => (
        <View key={index} style={styles.row} collapsable={false}>
          {row}
        </View>
      ))}
    </View>
  );
}

// One flush block of tiles sharing the width. TV: the rows share whatever height the host gives the
// grid, so the screen never scrolls. Phone: each tile as tall as it is wide, in a scrolling page.
const styles = StyleSheet.create({
  grid: {
    flex: IS_TV ? 1 : undefined,
  },
  row: {
    flexDirection: "row",
    flex: IS_TV ? 1 : undefined,
  },
  // One hairline on every tile, the hex box included, so none carries an edge the others lack.
  tile: {
    flex: 1,
    aspectRatio: IS_TV ? undefined : 1,
    borderWidth: IS_TV ? 2 : 1,
    borderColor: COLORS.SURFACE_MUTED,
    alignItems: "center",
    justifyContent: "center",
  },
  // An inset ring: inside the tile's own box, so it never touches a neighbour or changes the border.
  tileFocused: {
    boxShadow: `inset 0 0 0 5px ${COLORS.TEXT_PRIMARY}`,
  },
  // Sunken like the app's fields until it holds a colour of its own.
  hexTile: {
    backgroundColor: COLORS.SURFACE,
  },
  hexText: {
    paddingHorizontal: 10,
    fontSize: 22,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  hexInput: {
    width: "100%",
    height: "100%",
    textAlign: "center",
    fontSize: IS_TV ? 22 : 12,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
});
