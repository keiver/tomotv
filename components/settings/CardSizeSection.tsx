import { CardSizePicker } from "@/components/settings/CardSizePicker";
import { DurationChips } from "@/components/settings/DurationChips";
import { SectionFooter } from "@/components/settings/SectionFooter";
import { settingsStyles } from "@/components/settings/styles";
import { CARD_SIZES } from "@/constants/app";
import { useCardZoom, useCardZoomCeiling } from "@/hooks/useCardZoom";
import { useUiPreferences } from "@/hooks/useUiPreferences";
import { setCardZoom } from "@/services/cardZoom";
import { t } from "@/services/i18n";
import { cardSizePicks, nearestCardSize, shownCardSize } from "@/utils/cardZoom";
import { THIS_DEVICE } from "@/utils/hostEnvironment";
import React from "react";
import { Platform, Text, View } from "react-native";

const IS_TV = Platform.isTV;

/** The saved card size on the Appearance screen: pills over the steps on TV, miniature cards at each size the window takes elsewhere. */
export function CardSizeSection() {
  const { cardSize } = useUiPreferences();
  const zoom = useCardZoom();
  const ceiling = useCardZoomCeiling();
  const percent = (size: number) => t("appearance.cardSizePercent").replace("{percent}", String(Math.round(size * 100)));
  const picks = cardSizePicks(ceiling);
  const hint = THIS_DEVICE === "Mac" ? t("appearance.cardSizeHintMac") : THIS_DEVICE === "iPad" ? t("appearance.cardSizeHintPinch") : t("appearance.cardSizeHint");

  return (
    <>
      <View style={settingsStyles.sectionHeader}>
        <Text style={settingsStyles.sectionHeaderText}>{t("appearance.cardSizeHeader")}</Text>
      </View>
      <View style={settingsStyles.section}>
        {IS_TV ? (
          <DurationChips options={CARD_SIZES.map((size) => ({ value: size, label: percent(size) }))} selected={shownCardSize(cardSize, CARD_SIZES)} onSelect={setCardZoom} />
        ) : (
          <CardSizePicker sizes={picks} selected={nearestCardSize(zoom, picks)} format={percent} onSelect={setCardZoom} />
        )}
        <SectionFooter>
          <Text style={settingsStyles.sectionNote}>{hint}</Text>
        </SectionFooter>
      </View>
    </>
  );
}
