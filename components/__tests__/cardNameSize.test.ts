/** Card names read 11 pt on iPhone and 13 pt on iPad. */
function standText(isPad: boolean) {
  let text!: typeof import("@/components/card-stand").STAND_NAME_TEXT;
  jest.isolateModules(() => {
    const { Platform } = require("react-native") as typeof import("react-native");
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
    Object.defineProperty(Platform, "isPad", { value: isPad, configurable: true });
    text = (require("@/components/card-stand") as typeof import("@/components/card-stand")).STAND_NAME_TEXT;
  });
  return text;
}

describe("card name size", () => {
  it("is 11 pt with 1 pt tracking on iPhone", () => {
    expect(standText(false)).toMatchObject({ fontSize: 11, letterSpacing: 1 });
  });

  it("is 13 pt with 1.2 pt tracking on iPad", () => {
    expect(standText(true)).toMatchObject({ fontSize: 13, letterSpacing: 1.2 });
  });
});
