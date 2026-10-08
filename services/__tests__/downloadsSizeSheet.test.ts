/** The download size picker: the native sheet's options, which ones are greyed, and the reason it gives. */
import { blockedSizesNote, showSizeSheet, sizeChoice } from "@/services/downloads/sizeSheet";
import { ActionSheetIOS } from "react-native";

type SheetCallback = (index: number) => void;

beforeEach(() => {
  jest.spyOn(ActionSheetIOS, "showActionSheetWithOptions").mockImplementation(() => {});
});

const lastSheet = () => (ActionSheetIOS.showActionSheetWithOptions as jest.Mock).mock.calls.at(-1) as [Record<string, unknown>, SheetCallback];

describe("sizeChoice", () => {
  it("joins the label and the size, and stands alone when the size is unknown", () => {
    expect(sizeChoice("1080p", 1.1 * 1024 ** 3)).toBe("1080p · 1.10 GB");
    expect(sizeChoice("Original", 0)).toBe("Original");
  });
});

describe("blockedSizesNote", () => {
  it("names who turned transcoding off, and says nothing when nobody did", () => {
    expect(blockedSizesNote("device")).toContain("off in Settings");
    expect(blockedSizesNote("account")).toContain("server account");
    expect(blockedSizesNote(null)).toBeNull();
  });
});

describe("showSizeSheet", () => {
  it("greys the disabled sizes, puts Cancel last, and presses only an enabled size", () => {
    const original = jest.fn();
    const small = jest.fn();
    showSizeSheet("Film", "Body", [
      { text: "Original · 6 GB", onPress: original },
      { text: "720p · 2 GB", disabled: true, onPress: small },
    ]);
    const [options, callback] = lastSheet();
    expect(options).toMatchObject({ title: "Film", message: "Body", options: ["Original · 6 GB", "720p · 2 GB", "Cancel"], cancelButtonIndex: 2, disabledButtonIndices: [1] });

    callback(1);
    callback(2);
    expect(small).not.toHaveBeenCalled();
    callback(0);
    expect(original).toHaveBeenCalledTimes(1);
  });
});
