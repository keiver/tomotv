import { sideInsets } from "@/components/settings/styles";
import { Platform } from "react-native";

function withTV<T>(isTV: boolean, run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(Platform, "isTV");
  Object.defineProperty(Platform, "isTV", { configurable: true, value: isTV });
  try {
    return run();
  } finally {
    if (original) Object.defineProperty(Platform, "isTV", original);
  }
}

describe("sideInsets", () => {
  it("pads each side by its own inset on phone, so an uneven side column is cleared", () => {
    expect(withTV(false, () => sideInsets({ left: 0, right: 86 }))).toEqual({ paddingLeft: 0, paddingRight: 86 });
  });

  it("keeps a style's own horizontal padding on top of each inset", () => {
    expect(withTV(false, () => sideInsets({ left: 0, right: 86 }, 40))).toEqual({ paddingLeft: 40, paddingRight: 126 });
  });

  it("adds no padding on TV", () => {
    expect(withTV(true, () => sideInsets({ left: 80, right: 80 }))).toBeNull();
    expect(withTV(true, () => sideInsets({ left: 80, right: 80 }, 40))).toBeNull();
  });
});
