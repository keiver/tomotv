import { HUD_ACTION_ICON, HudAction } from "@/components/live-tv/guide-corner-actions";
import { GROUP_CELL_HEIGHT, GuideGroupCell } from "@/components/live-tv/guide-group-cell";
import { HudBand } from "@/components/live-tv/guide-hud";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useChannelFilterChoices } from "@/hooks/useChannelFilterChoices";
import { useLiveTvPreferences } from "@/hooks/useLiveTvPreferences";
import { t } from "@/services/i18n";
import { updateLiveTvPreferences } from "@/services/liveTvPreferences";
import { useRouter } from "expo-router";
import React from "react";
import { StyleSheet, View } from "react-native";

const PILL_RADIUS = GROUP_CELL_HEIGHT / 2;

/** The channel wall's head, a pill: + for a new group, then the groups to pick one from. */
export function WallGroupsBand() {
  const router = useRouter();
  const { accent } = useCardPalette();
  const choices = useChannelFilterChoices();
  const { filter } = useLiveTvPreferences();
  return (
    <View style={styles.pill} testID="wall-groups-pill">
      <HudBand
        flush
        cornerActions={
          <HudAction
            titled
            topLeftRadius={PILL_RADIUS}
            bottomLeftRadius={PILL_RADIUS}
            label={t("liveTv.newGroup")}
            onPress={() => router.push("/channel-group")}
            icon={<SfSymbolIcon name="plus" size={HUD_ACTION_ICON} color={accent} weight="bold" />}
          />
        }>
        {choices.map((choice) => (
          <GuideGroupCell key={choice.filter} label={choice.label} selected={choice.filter === filter} onPress={() => updateLiveTvPreferences({ filter: choice.filter })} />
        ))}
      </HudBand>
    </View>
  );
}

const styles = StyleSheet.create({
  // Round ends; the clip takes the right end off the cells scrolled under it.
  pill: {
    borderRadius: PILL_RADIUS,
    overflow: "hidden",
  },
});
