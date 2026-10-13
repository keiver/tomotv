import { AVATAR_CAPTION_LINE, AVATAR_CELL_WIDTH, AVATAR_SIZE, AVATAR_SUBCAPTION_LINE, IS_PAD, STRIP_INSET } from "@/components/settings/styles";
import { themeName } from "@/components/theme/theme-name";
import { COLORS } from "@/constants/colors";
import { cardPalette, type CardTheme } from "@/services/cardTheme";
import { t } from "@/services/i18n";
import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useRef } from "react";
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

const IS_TV = Platform.isTV;
const RING = IS_TV ? 4 : 2;
/** Air between the ring and the disc. */
const RING_GAP = IS_TV ? 4 : 2;
const BADGE = IS_TV ? 30 : 20;
const RING_RADIUS = (AVATAR_SIZE + 2 * (RING + RING_GAP)) / 2;
/** Air between cells, shared by the layout and the scroll-into-view arithmetic. */
const GAP = 4;

/** One theme in the strip. */
export interface StripTheme {
  theme: CardTheme;
  /** A saved theme: held it asks to go. */
  saved: boolean;
  /** Saved here, not yet on the server. */
  pending: boolean;
}

interface ThemeStripProps {
  items: StripTheme[];
  chosenId: string;
  onPick: (theme: CardTheme) => void;
  onEdit: (theme: CardTheme) => void;
  onRemove: (theme: CardTheme) => void;
}

/**
 * The themes as a horizontal band of colour discs, the account strip's grammar: a disc with its
 * name under it, the chosen one ringed in its own colour with a tick badge. A press applies at
 * once; the chosen theme pressed again opens in the editor, and a long press asks to remove a saved one.
 */
export function ThemeStrip({ items, chosenId, onPick, onEdit, onRemove }: ThemeStripProps) {
  // tvOS lets focus leave a scroll view only at its matching end, so the ends pin the offset.
  const listRef = useRef<ScrollView>(null);
  const pinToStart = useCallback(() => listRef.current?.scrollTo({ x: 0, y: 0, animated: false }), []);
  const pinToEnd = useCallback(() => listRef.current?.scrollToEnd({ animated: false }), []);
  // The chosen disc scrolls into view: a theme saved from the editor lands at the strip's end.
  const chosenIndex = items.findIndex(({ theme }) => theme.id === chosenId);
  const settled = useRef(false);
  useEffect(() => {
    if (chosenIndex >= 0) listRef.current?.scrollTo({ x: chosenIndex * (AVATAR_CELL_WIDTH + GAP), animated: settled.current });
    settled.current = true;
  }, [chosenIndex]);
  return (
    <View style={styles.band}>
      <ScrollView ref={listRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" focusable={false}>
        {items.map(({ theme, saved, pending }, index) => {
          const chosen = theme.id === chosenId;
          const palette = cardPalette(theme.accent);
          const label = themeName(theme);
          return (
            <Pressable
              key={theme.id}
              testID={`theme-cell-${theme.id}`}
              onPress={() => (chosen ? onEdit(theme) : onPick(theme))}
              onLongPress={saved ? () => onRemove(theme) : undefined}
              onFocus={index === 0 ? pinToStart : index === items.length - 1 ? pinToEnd : undefined}
              hasTVPreferredFocus={chosen}
              isTVSelectable
              tvParallaxProperties={{ enabled: false }}
              style={({ pressed }) => [styles.cell, pressed && styles.cellPressed]}
              accessibilityRole="button"
              accessibilityLabel={label}
              accessibilityState={{ selected: chosen }}
              accessibilityActions={
                saved
                  ? [
                      { name: "edit", label: t("appearance.edit") },
                      { name: "remove", label: t("common.remove") },
                    ]
                  : [{ name: "edit", label: t("appearance.edit") }]
              }
              onAccessibilityAction={(event) => (event.nativeEvent.actionName === "remove" && saved ? onRemove(theme) : onEdit(theme))}>
              {({ focused }) => (
                <>
                  <View style={[styles.ring, chosen && { borderColor: palette.accent }, focused && styles.ringFocused]} collapsable={false}>
                    <View style={[styles.disc, { backgroundColor: theme.accent }]} />
                    {chosen ? (
                      <View style={[styles.badge, { backgroundColor: palette.accentDeep }]}>
                        <Ionicons name="checkmark" size={BADGE * 0.7} color={palette.onAccent} />
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.caption, (chosen || focused) && styles.captionStrong]} numberOfLines={1}>
                    {label}
                  </Text>
                  {/* The hex under every disc: two themes may share a name, the colour tells them apart. */}
                  <Text style={styles.subcaption} numberOfLines={1}>
                    {pending ? t("appearance.notSynced") : theme.accent}
                  </Text>
                </>
              )}
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  band: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
  },
  content: {
    paddingHorizontal: STRIP_INSET,
    paddingVertical: STRIP_INSET,
    gap: GAP,
  },
  cell: {
    width: AVATAR_CELL_WIDTH,
    alignItems: "center",
  },
  cellPressed: {
    opacity: 0.6,
  },
  ring: {
    padding: RING_GAP,
    borderWidth: RING,
    borderColor: "transparent",
    borderRadius: RING_RADIUS,
  },
  ringFocused: {
    borderColor: COLORS.BORDER_FOCUSED,
  },
  disc: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
  },
  badge: {
    position: "absolute",
    right: -RING,
    bottom: -RING,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: COLORS.SURFACE,
  },
  caption: {
    marginTop: IS_TV ? 8 : 6,
    fontSize: IS_TV ? 20 : IS_PAD ? 14 : 13,
    lineHeight: AVATAR_CAPTION_LINE,
    color: COLORS.TEXT_SECONDARY,
    maxWidth: AVATAR_CELL_WIDTH,
  },
  captionStrong: {
    color: COLORS.TEXT_PRIMARY,
    fontWeight: "600",
  },
  subcaption: {
    fontSize: IS_TV ? 17 : IS_PAD ? 12 : 11,
    lineHeight: AVATAR_SUBCAPTION_LINE,
    color: COLORS.TEXT_TERTIARY,
    maxWidth: AVATAR_CELL_WIDTH,
  },
});
