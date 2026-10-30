import { DurationChips } from "@/components/settings/DurationChips";
import { DurationSlider } from "@/components/settings/DurationSlider";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { useCardZoomCeiling } from "@/hooks/useCardZoom";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { setCardZoom } from "@/services/cardZoom";
import { t } from "@/services/i18n";
import { cardSizeChoices, shownCardSize } from "@/utils/cardZoom";
import { THIS_DEVICE } from "@/utils/hostEnvironment";
import React from "react";
import { Platform, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** The saved card size on the Appearance screen: pills on TV, the stepped slider on touch and the Mac. */
export function CardSizeSection() {
  const { cardSize } = useUiPreferences();
  const ceiling = useCardZoomCeiling();
  const choices = cardSizeChoices(ceiling, IS_TV);
  const options = choices.map((size) => ({ value: size, label: t("appearance.cardSizePercent").replace("{percent}", String(Math.round(size * 100))) }));
  const shown = shownCardSize(cardSize, choices);
  const hint = THIS_DEVICE === "Mac" ? t("appearance.cardSizeHintMac") : THIS_DEVICE === "iPad" ? t("appearance.cardSizeHintPinch") : t("appearance.cardSizeHint");

  return (
    <>
      <View style={settingsStyles.sectionHeader}>
        <Text style={settingsStyles.sectionHeaderText}>{t("appearance.cardSizeHeader")}</Text>
      </View>
      <View style={settingsStyles.section}>
        {IS_TV ? (
          <DurationChips options={options} selected={shown} onSelect={setCardZoom} />
        ) : (
          <DurationSlider options={options} selected={shown} onSelect={setCardZoom} accessibilityLabel={t("appearance.cardSize")} />
        )}
        <SectionFooter>
          <Text style={settingsStyles.sectionNote}>{hint}</Text>
        </SectionFooter>
      </View>
    </>
  );
}
