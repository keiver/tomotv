/** Multiview's full screen route: one invisible, focusable view over the whole screen whose select or tap returns to the layout. */
import React from "react";
import { StyleSheet, TouchableOpacity } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockBack = jest.fn();
jest.mock("expo-router", () => ({ useRouter: () => ({ back: mockBack }) }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

import MultiviewFullScreen from "@/app/multiview-full";

describe("Multiview full screen", () => {
  it("holds focus over the whole screen with nothing drawn, and goes back on select", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<MultiviewFullScreen />);
    });
    const holder = tree.root.findByType(TouchableOpacity);
    expect(holder.props).toMatchObject({ hasTVPreferredFocus: true, activeOpacity: 1 });
    expect(StyleSheet.flatten(holder.props.style)).toMatchObject({ position: "absolute", top: 0, left: 0, right: 0, bottom: 0 });
    expect(holder.props.children).toBeUndefined();
    act(() => holder.props.onPress());
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
