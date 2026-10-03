/** The info panel's Stop circle outlives its recording while it holds focus, so tvOS focus never falls off the row. */
import { InfoActionRow } from "@/components/info-action-row";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/components/glass-button", () => ({ GlassButton: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@/services/i18n", () => ({ t: (key: string) => key }));

const { GlassButton } = jest.requireMock("@/components/glass-button") as { GlassButton: React.ComponentType };
type CircleProps = { accessibilityLabel: string; onFocus: () => void; onBlur: () => void; onPress?: () => void };
const stopCircle = (renderer: TestRenderer.ReactTestRenderer) =>
  renderer.root.findAllByType(GlassButton).find((node) => (node.props as CircleProps).accessibilityLabel === "liveTv.stopRecording")?.props as CircleProps | undefined;

describe("InfoActionRow stop circle", () => {
  it("stays, spent, while focused after the recording stops, and leaves with focus", async () => {
    const stop = jest.fn(async () => true);
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<InfoActionRow onStopRecording={stop} />);
    });
    await act(async () => stopCircle(renderer)!.onFocus());
    await act(async () => renderer.update(<InfoActionRow />));
    const spent = stopCircle(renderer);
    expect(spent).toBeDefined();
    expect(spent!.onPress).toBeUndefined();
    await act(async () => spent!.onBlur());
    expect(stopCircle(renderer)).toBeUndefined();
  });

  it("goes at once when the recording stops without focus on it", async () => {
    let renderer!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      renderer = TestRenderer.create(<InfoActionRow onStopRecording={jest.fn(async () => true)} />);
    });
    await act(async () => renderer.update(<InfoActionRow />));
    expect(stopCircle(renderer)).toBeUndefined();
  });
});
