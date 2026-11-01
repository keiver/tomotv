/** On tvOS the row's caption names the focused control, so no word renders under a glass circle. */
import { GlassWord } from "@/components/glass-toggle-group";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("react-native", () => {
  const reactNative = jest.requireActual("react-native");
  Object.defineProperty(reactNative.Platform, "isTV", { configurable: true, value: true });
  return reactNative;
});
jest.mock("@/components/glass-button", () => ({ GlassButton: () => null, CAPSULE_PADDING: 4, GLASS_PILL_PARALLAX: {} }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

it("renders no word on tvOS", async () => {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(<GlassWord>Favorite</GlassWord>);
  });
  expect(renderer.toJSON()).toBeNull();
});
