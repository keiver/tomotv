import { t } from "@/services/i18n";
import type { ServerTranscodeBlock } from "@/services/transcodePolicy";
import { formatFileSize } from "@/utils/mediaInfo";
import { ActionSheetIOS } from "react-native";

/** A size button: "1080p · 1.1 GB", or the label alone when the size is unknown. */
export function sizeChoice(label: string, bytes: number): string {
  return bytes > 0 ? t("downloads.sizeChoice").replace("{label}", label).replace("{size}", formatFileSize(bytes)) : label;
}

/** One size in the sheet. A disabled one is drawn greyed and cannot be pressed. */
export interface SheetChoice {
  text: string;
  disabled?: boolean;
  onPress: () => void;
}

/** Why the smaller sizes are greyed: said under the sheet's body, null when they are not. */
export function blockedSizesNote(block: ServerTranscodeBlock | null): string | null {
  if (block === "account") return t("downloads.smallerAccountBlocked");
  if (block === "device") return t("downloads.smallerNeedsTranscoding");
  return null;
}

/** The download size picker: the native action sheet, Cancel last. Centred on iPad, no anchor needed. */
export function showSizeSheet(title: string, message: string, choices: SheetChoice[]): void {
  ActionSheetIOS.showActionSheetWithOptions(
    {
      title,
      message,
      options: [...choices.map((choice) => choice.text), t("common.cancel")],
      cancelButtonIndex: choices.length,
      disabledButtonIndices: choices.flatMap((choice, index) => (choice.disabled ? [index] : [])),
    },
    (index) => {
      const choice = choices[index];
      if (choice && !choice.disabled) choice.onPress();
    },
  );
}
