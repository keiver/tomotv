/** A caller can mark a button disabled for assistive tech while it stays focusable, as the spent stop circle does. */
import { FocusableButton } from "@/components/FocusableButton";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

type PressableProps = { accessibilityState?: { disabled?: boolean; selected?: boolean }; isTVSelectable?: boolean; disabled?: boolean };

async function render(element: React.ReactElement) {
  let renderer!: TestRenderer.ReactTestRenderer;
  await act(async () => {
    renderer = TestRenderer.create(element);
  });
  // The first node carrying the button's own props, before any host view flattens them.
  return renderer.root.findAll((node) => node.props.accessibilityRole === "button" && "isTVSelectable" in node.props)[0].props as PressableProps;
}

describe("FocusableButton accessibility state", () => {
  it("reports a caller's disabled while the button stays selectable", async () => {
    const props = await render(<FocusableButton title="Stop" accessibilityState={{ disabled: true }} onPress={() => {}} />);
    expect(props.accessibilityState?.disabled).toBe(true);
    expect(props.isTVSelectable).toBe(true);
  });

  it("keeps a caller's selected and reports its own disabled", async () => {
    const props = await render(<FocusableButton title="Heart" accessibilityState={{ selected: true }} disabled onPress={() => {}} />);
    expect(props.accessibilityState).toMatchObject({ selected: true, disabled: true });
  });

  it("reads enabled when nothing disables it", async () => {
    const props = await render(<FocusableButton title="Play" onPress={() => {}} />);
    expect(props.accessibilityState?.disabled).toBe(false);
  });
});
