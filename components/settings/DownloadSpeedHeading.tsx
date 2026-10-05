import { formatMbps, RateHeading } from "@/components/settings/RateHeading";
import { COLORS } from "@/constants/colors";
import { downloadManager } from "@/services/downloads/manager";
import { t } from "@/services/i18n";
import { useEffect, useState } from "react";

/** The heading's figure: the running transfers' rate in Mbps, nothing while none runs. */
export function downloadRateLabel(bytesPerSecond: number): string | null {
  return bytesPerSecond > 0 ? formatMbps(bytesPerSecond * 8) : null;
}

/** ON THIS DEVICE with the live download rate on its right, in the streaming heading's shape. */
export function DownloadSpeedHeading() {
  // Subscribed here rather than on the screen, like a row's counter: a tick must not re-render the list.
  const [bytesPerSecond, setBytesPerSecond] = useState(0);
  useEffect(() => downloadManager.subscribeThroughput(setBytesPerSecond), []);

  const title = t("downloads.onThisDevice");
  const rate = downloadRateLabel(bytesPerSecond);
  const spoken = rate ? `${title}. ${t("downloads.downloadingAt").replace("{rate}", rate)}` : title;
  return <RateHeading first title={title} glyph="arrow-down-circle" rate={rate?.toUpperCase() ?? ""} ink={rate ? COLORS.SUCCESS : undefined} spoken={spoken} />;
}
