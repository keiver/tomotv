import { AmbientBackground } from "@/components/ambient-background";
import { GlassButton } from "@/components/glass-button";
import { settingsStyles } from "@/components/settings/styles";
import { brightnessGradient, hueGradient, saturationGradient } from "@/components/theme/gradients";
import { HsbSlider } from "@/components/theme/hsb-slider";
import { inPalette, SwatchGrid } from "@/components/theme/swatch-grid";
import { ThemePreview } from "@/components/theme/theme-preview";
import { COLORS } from "@/constants/colors";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { isLowContrast, newThemeId, themeToSave } from "@/services/cardTheme";
import { t } from "@/services/i18n";
import { saveTheme } from "@/services/themeLibrary";
import { updateUiPreferences } from "@/services/uiPreferences";
import { hexToHsb, hsbToHex, normalizeHex, type Hsb } from "@/utils/color";
import { logger } from "@/utils/logger";
import { useHeaderHeight } from "expo-router/react-navigation";
import { Stack, useLocalSearchParams, useRouter, type NativeStackNavigationOptions } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, findNodeHandle, Platform, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const IS_TV = Platform.isTV;
const HUE_TRACK = hueGradient();
/** The preview card's share of a TV screen's height; the palette and sliders take the rest with no scrolling. */
const TV_PREVIEW_SHARE = 0.3;
/** Landscape at this height is 236pt wide: the card reads, and the palette keeps most of the screen. */
const PHONE_PREVIEW_HEIGHT = 140;
const NOTE_LINE = IS_TV ? 26 : 16;

/**
 * Makes or edits a saved theme, as one sunken card: a preview card in the chosen colour centred at the
 * top, the palette, and the sliders in the card's footer. Save asks for the name in the system's own
 * prompt (as renaming a server does), from the navigation bar on phone and iPad and from a glass
 * button above the card on TV. Only a named save keeps anything: leaving without one drops the colour.
 */
export default function ThemeEditorScreen() {
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const { height } = useWindowDimensions();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; name?: string; accent?: string }>();
  const { cardTheme } = useUiPreferences();
  const { accent } = useCardPalette();

  // The id a new theme saves under.
  const [freshId] = useState(() => newThemeId());
  const [initialHex] = useState(() => normalizeHex(params.accent ?? "") ?? cardTheme.accent);
  const [hsb, setHsb] = useState<Hsb>(() => hexToHsb(initialHex));
  const [hexInvalid, setHexInvalid] = useState(false);
  // TV: the tile under focus, shown before it is picked.
  const [hover, setHover] = useState<string | null>(null);
  // TV: Save's native node, where Up goes from the first palette row past the preview card. Set once
  // the button is mounted: Fabric resolves nextFocus* tags only against views already in the tree.
  const [saveHandle, setSaveHandle] = useState<number | undefined>(undefined);
  const saveRef = useCallback((node: View | null) => setSaveHandle(node && IS_TV ? (findNodeHandle(node) ?? undefined) : undefined), []);

  const hex = hsbToHex(hsb);
  const shown = hover ?? hex;
  const clearHover = () => setHover(null);
  const pick = (next: string) => {
    setHsb(hexToHsb(next));
    setHover(null);
    setHexInvalid(false);
  };

  // The colour the prompt saves, read when Save is pressed rather than captured at render.
  const latestHex = useRef(hex);
  useEffect(() => {
    latestHex.current = hex;
  }, [hex]);
  // The theme this screen is editing; a first save gives a new one its id and name.
  const opened = useRef({ id: params.id, name: params.name });

  // A saved theme goes back to the list on both platforms. The crash app/channel-group.tsx works around
  // (popping a screen whose own text field holds focus) cannot happen: TV draws no text field here, and
  // focus is on the prompt's button when Save fires.
  const promptSave = useCallback(() => {
    Alert.prompt(
      t("themeEditor.saveTitle"),
      t("themeEditor.saveBody"),
      [
        { text: t("common.cancel"), style: "cancel" },
        {
          text: t("common.save"),
          onPress: (text?: string) => {
            const theme = themeToSave(opened.current, text ?? "", latestHex.current, freshId);
            if (!theme) return;
            opened.current = { id: theme.id, name: theme.name };
            updateUiPreferences({ cardTheme: theme });
            saveTheme(theme).catch((error) => logger.warn("Theme save failed", error, { service: "ThemeEditor" }));
            router.back();
          },
        },
      ],
      "plain-text",
      opened.current.name ?? "",
    );
  }, [freshId, router]);

  const screenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({ unstable_headerRightItems: () => [{ type: "button", label: t("common.save"), tintColor: accent, onPress: promptSave }] }),
    [promptSave, accent],
  );

  const focusHex = useMemo(() => (inPalette(initialHex) ? initialHex : undefined), [initialHex]);
  const lowContrast = isLowContrast(shown);

  const card = (
    <View style={[settingsStyles.section, styles.card]}>
      <View style={styles.preview}>
        <ThemePreview accent={shown} cardHeight={IS_TV ? Math.round(height * TV_PREVIEW_SHARE) : PHONE_PREVIEW_HEIGHT} />
      </View>

      <View style={styles.grid}>
        <SwatchGrid
          selected={hex}
          onPick={pick}
          onPreview={IS_TV ? setHover : undefined}
          onHexFocus={clearHover}
          focusHex={focusHex}
          hexLabel={t("themeEditor.hex")}
          hexHint={t("themeEditor.hexInvalid")}
          hexCancel={t("common.cancel")}
          hexDone={t("common.ok")}
          onHexInvalid={setHexInvalid}
          firstRowUp={saveHandle}
        />
      </View>

      {/* The card runs out into a sunken band, the way a settings card runs into its note. */}
      <View style={[styles.footer, settingsStyles.noteShadow]}>
        <HsbSlider
          label={t("themeEditor.hue")}
          value={hsb.h}
          max={360}
          step={5}
          readout={`${Math.round(hsb.h)}°`}
          gradient={HUE_TRACK}
          onChange={(h) => setHsb((prev) => ({ ...prev, h }))}
          onFocus={clearHover}
          hasTVPreferredFocus={!focusHex}
        />
        <HsbSlider
          label={t("themeEditor.saturation")}
          value={hsb.s * 100}
          max={100}
          step={5}
          readout={`${Math.round(hsb.s * 100)}%`}
          gradient={saturationGradient(hsb)}
          onChange={(s) => setHsb((prev) => ({ ...prev, s: s / 100 }))}
          onFocus={clearHover}
        />
        <HsbSlider
          label={t("themeEditor.brightness")}
          value={hsb.b * 100}
          max={100}
          step={5}
          readout={`${Math.round(hsb.b * 100)}%`}
          gradient={brightnessGradient(hsb)}
          onChange={(b) => setHsb((prev) => ({ ...prev, b: b / 100 }))}
          onFocus={clearHover}
        />
        {/* One line, always laid out, right under the last slider: a message coming or going never moves anything. */}
        <Text style={[styles.note, hexInvalid && styles.noteError]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8} testID="theme-note">
          {hexInvalid ? t("themeEditor.hexInvalid") : lowContrast ? t("themeEditor.lowContrast") : ""}
        </Text>
      </View>
    </View>
  );

  if (IS_TV) {
    return (
      <View style={styles.container}>
        <AmbientBackground />
        {/* The width and spacing every TV settings screen gives its cards (app/language.tsx). One screen, no scrolling. */}
        <View style={[styles.tvPage, { paddingTop: insets.top + 40, paddingBottom: insets.bottom + 60 }]}>
          <View style={[settingsStyles.contentContainer, styles.tvColumn]}>
            <View style={styles.tvActions}>
              <GlassButton ref={saveRef} title={t("common.save")} onPress={promptSave} onFocus={clearHover} />
            </View>
            {card}
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Stack.Screen options={screenOptions} />
      <AmbientBackground />
      {/* The keyboard insets scroll the focused field (the hex box) above the keyboard. */}
      <ScrollView
        contentContainerStyle={[styles.phonePage, { paddingTop: headerHeight + 12, paddingBottom: 24 + insets.bottom }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        <View style={settingsStyles.contentContainer}>{card}</View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  tvPage: {
    flex: 1,
    alignItems: "center",
  },
  tvColumn: {
    flex: 1,
    gap: 16,
  },
  tvActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  phonePage: {
    alignItems: "center",
  },
  // TV: the card is the screen. Its own bottom gap is for stacked cards, and here there is one.
  card: {
    flex: IS_TV ? 1 : undefined,
    marginBottom: 0,
  },
  // The card's own padding holds its focus glow; this is the air above and below it.
  preview: {
    paddingTop: IS_TV ? 16 : 12,
    paddingBottom: IS_TV ? 8 : 12,
  },
  // Inset to the rows' text edge (settingsStyles.listItem), like everything else in the card.
  grid: {
    flex: IS_TV ? 1 : undefined,
    marginHorizontal: settingsStyles.listItem.paddingHorizontal,
    marginBottom: IS_TV ? 24 : 16,
  },
  // The palette's inset, so the tracks line up under the tiles. The bottom is a few points shy of the
  // top: the note's own line closes the band.
  footer: {
    backgroundColor: COLORS.SURFACE_SUNKEN,
    paddingHorizontal: settingsStyles.listItem.paddingHorizontal,
    paddingTop: IS_TV ? 16 : 12,
    paddingBottom: IS_TV ? 8 : 6,
  },
  note: {
    fontSize: IS_TV ? 20 : 12,
    lineHeight: NOTE_LINE,
    height: NOTE_LINE,
    color: COLORS.TEXT_TERTIARY,
    textAlign: "center",
  },
  noteError: {
    color: COLORS.DESTRUCTIVE_SOFT,
  },
});
