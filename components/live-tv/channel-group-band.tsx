import { promptChannelGroup } from "@/components/live-tv/channel-group-prompt";
import { HUD_ACTION_ICON, HudAction } from "@/components/live-tv/guide-corner-actions";
import { GuideGroupCell } from "@/components/live-tv/guide-group-cell";
import { HudBand } from "@/components/live-tv/guide-hud";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useChannelGroupChoices } from "@/hooks/useChannelGroupChoices";
import { t } from "@/services/i18n";
import { type ChannelIdentity } from "@/services/liveTvPreferences";
import React, { useState } from "react";

// The section card's radius (settingsStyles.section): the end cells sit in its bottom corners.
const CARD_RADIUS = 32;

interface ChannelGroupBandProps {
  channel: ChannelIdentity;
  /** TV: where Up from + lands, since no CTA sits straight above the corner. */
  nextFocusUp?: number;
  /** The host card's bottom radius, which the end cells round to. */
  cornerRadius?: number;
}

/** The guide's groups for one channel, own and playlist alike: + names a new group holding it, a cell press adds or removes it. */
export function ChannelGroupBand({ channel, nextFocusUp, cornerRadius = CARD_RADIUS }: ChannelGroupBandProps) {
  const { accent } = useCardPalette();
  const choices = useChannelGroupChoices(channel);
  // The last cell sits in the card's corner only when the cells reach the band's end.
  const [filled, setFilled] = useState(false);
  return (
    <HudBand
      flush
      onPlaceholderLayout={({ nativeEvent }) => setFilled(nativeEvent.layout.width < 1)}
      cornerActions={
        <HudAction
          titled
          bottomLeftRadius={cornerRadius}
          nextFocusUp={nextFocusUp}
          label={t("liveTv.newGroup")}
          onPress={() => promptChannelGroup({ channel })}
          icon={<SfSymbolIcon name="plus" size={HUD_ACTION_ICON} color={accent} weight="bold" />}
        />
      }>
      {choices.map((choice, index) => (
        <GuideGroupCell key={choice.key} label={choice.label} selected={choice.member} onPress={choice.toggle} bottomRightRadius={filled && index === choices.length - 1 ? cornerRadius : undefined} />
      ))}
    </HudBand>
  );
}
