import { HUD_ACTION_ICON, HudAction } from "@/components/live-tv/guide-corner-actions";
import { GuideGroupCell } from "@/components/live-tv/guide-group-cell";
import { HudBand } from "@/components/live-tv/guide-hud";
import { SfSymbolIcon } from "@/components/sf-symbol-icon";
import { useCardPalette } from "@/hooks/useCardPalette";
import { useChannelGroupChoices } from "@/hooks/useChannelGroupChoices";
import { t } from "@/services/i18n";
import { type ChannelIdentity } from "@/services/liveTvPreferences";
import { useRouter } from "expo-router";
import React from "react";

// The section card's radius (settingsStyles.section): the end cells sit in its bottom corners.
const CARD_RADIUS = 32;

interface ChannelGroupBandProps {
  channel: ChannelIdentity;
  /** TV: where Up from + lands, since no CTA sits straight above the corner. */
  nextFocusUp?: number;
}

/** The guide's groups for one channel, own and playlist alike: + names a new group holding it, a cell press adds or removes it. */
export function ChannelGroupBand({ channel, nextFocusUp }: ChannelGroupBandProps) {
  const router = useRouter();
  const { accent } = useCardPalette();
  const choices = useChannelGroupChoices(channel);
  return (
    <HudBand
      flush
      cornerActions={
        <HudAction
          titled
          bottomLeftRadius={CARD_RADIUS}
          nextFocusUp={nextFocusUp}
          label={t("liveTv.newGroup")}
          onPress={() => router.push({ pathname: "/channel-group", params: { channelName: channel.Name, channelNumber: channel.ChannelNumber ?? "" } })}
          icon={<SfSymbolIcon name="plus" size={HUD_ACTION_ICON} color={accent} weight="bold" />}
        />
      }>
      {choices.map((choice, index) => (
        <GuideGroupCell key={choice.key} label={choice.label} selected={choice.member} onPress={choice.toggle} bottomRightRadius={index === choices.length - 1 ? CARD_RADIUS : undefined} />
      ))}
    </HudBand>
  );
}
