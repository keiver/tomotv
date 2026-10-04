import { foldText } from "../textFold";

describe("foldText", () => {
  it("lowercases, trims and drops accents so a plain query meets an accented listing", () => {
    expect(foldText("  München ")).toBe("munchen");
    expect(foldText("Fútbol Español")).toBe("futbol espanol");
    expect(foldText("MLB Baseball")).toBe("mlb baseball");
  });

  it("leaves text without marks as it is, apart from case", () => {
    expect(foldText("Yankees")).toBe("yankees");
    expect(foldText("")).toBe("");
  });
});
