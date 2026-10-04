/** The grid bar's search: the Search key hands over what the field holds now, never a term the screen already cleared. */
import { HeaderSearchReveal } from "@/components/header-search-reveal";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/glass-button", () => ({ GlassButton: () => null }));
jest.mock("@/components/sunken-text-input", () => {
  const { forwardRef } = jest.requireActual("react");
  return { SunkenTextInput: forwardRef(() => null) };
});

const { GlassButton } = jest.requireMock("@/components/glass-button") as { GlassButton: React.ComponentType };
const { SunkenTextInput } = jest.requireMock("@/components/sunken-text-input") as { SunkenTextInput: React.ComponentType };

function field(renderer: TestRenderer.ReactTestRenderer) {
  return renderer.root.findByType(SunkenTextInput).props as { onSubmitEditing: () => void; onChangeText: (text: string) => void };
}

describe("HeaderSearchReveal", () => {
  it("submits the cleared term after the screen drops the one it mounted with", async () => {
    const onChangeText = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<HeaderSearchReveal value="news" onChangeText={onChangeText} placeholder="Search" />);
    });
    // A filter pick clears the screen's term after this instance mounted with the old one.
    await act(async () => renderer.update(<HeaderSearchReveal value="" onChangeText={onChangeText} placeholder="Search" />));
    await act(async () => (renderer.root.findByType(GlassButton).props as { onPress: () => void }).onPress());
    await act(async () => field(renderer).onSubmitEditing());
    expect(onChangeText).toHaveBeenLastCalledWith("");
  });

  it("submits what was typed", async () => {
    const onChangeText = jest.fn();
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<HeaderSearchReveal value="" onChangeText={onChangeText} placeholder="Search" />);
    });
    await act(async () => (renderer.root.findByType(GlassButton).props as { onPress: () => void }).onPress());
    await act(async () => field(renderer).onChangeText("bbc"));
    await act(async () => field(renderer).onSubmitEditing());
    expect(onChangeText).toHaveBeenLastCalledWith("bbc");
  });
});
