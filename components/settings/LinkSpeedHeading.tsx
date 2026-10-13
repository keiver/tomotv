import { formatMbps, RateHeading } from "@/components/settings/RateHeading";
import { SERVER_GLYPH } from "@/components/settings/ServerRow";
import { COLORS } from "@/constants/colors";
import { carriedRungs } from "@/services/adaptiveQuality";
import { t } from "@/services/i18n";

/** What a re-measure tap answers with when no figure lands. */
export type LinkRateOutcome = "linkBusy" | "noReading";

/** The outcome a tap shows: a busy link is named without probing, a probe that read nothing says so. */
export function linkRateOutcome(bps: number | null, held: boolean, activeDownloads: number): LinkRateOutcome | null {
  if (held || activeDownloads > 0) return "linkBusy";
  return bps == null ? "noReading" : null;
}

interface LinkSpeedHeadingProps {
  title?: string;
  /** Measured speed to the connected server, bits/second; null = not measured. */
  measuredBps: number | null;
  /** A probe is running right now, so the figure reads as sampling. */
  measuring: boolean;
  /** The last tap's answer; while set it replaces the figure until the next focus or tap. */
  outcome?: LinkRateOutcome | null;
  /** A press on the heading asks for a fresh measurement. */
  onRemeasure?: () => void;
  /** TV focus lets the card below use this heading as its top edge. */
  onFocus?: () => void;
  onBlur?: () => void;
}

/** The streaming heading: measured server speed, a press re-measures it. */
export function LinkSpeedHeading({ title, measuredBps, measuring, outcome, onRemeasure, onFocus, onBlur }: LinkSpeedHeadingProps) {
  const measured = measuredBps != null && !measuring;
  // The tap's answer outranks everything but a running check: a press always shows its outcome.
  const answered = !measuring ? outcome : null;
  // Short on purpose: the pending strings share the header line with the title.
  const rate = measuring
    ? t("settings.checking")
    : answered
      ? t(answered === "linkBusy" ? "settings.linkBusy" : "settings.noReading")
      : measuredBps == null
        ? t("settings.notMeasured")
        : formatMbps(measuredBps);
  const spoken = measured ? t("settings.streamingConn").replace("{rate}", rate) : t("settings.streamingRate").replace("{rate}", rate);
  // A colour is a verdict, so only a landed measurement gets one: green while the
  // connection carries a preset, red once it carries none. The server glyph is the
  // connected card's, in the same ink, so the figure reads as that server's speed.
  // A probe that read nothing is a verdict too; a busy link is not.
  const rateInk = answered ? (answered === "noReading" ? COLORS.DESTRUCTIVE : undefined) : !measured ? undefined : carriedRungs(measuredBps) === 0 ? COLORS.DESTRUCTIVE : COLORS.SUCCESS;

  return (
    <RateHeading
      title={title ?? t("settings.streamingQuality")}
      rate={rate.toUpperCase()}
      glyph={SERVER_GLYPH}
      ink={rateInk}
      spoken={spoken}
      onPress={onRemeasure}
      disabled={measuring}
      hint={t("settings.measureAgain")}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}
