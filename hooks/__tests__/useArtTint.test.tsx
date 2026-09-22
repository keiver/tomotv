/** useArtTint: reads the tint once per programme while active, caches it, and returns null when inactive or the read fails. */
import { useArtTint } from "@/hooks/useArtTint";
import { Image } from "expo-image";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("expo-image", () => ({ Image: { loadAsync: jest.fn(), generateBlurhashAsync: jest.fn() } }));

const mockLoad = Image.loadAsync as jest.Mock;
const mockHash = Image.generateBlurhashAsync as jest.Mock;
type HookRef = { get: () => string | null };

const Harness = forwardRef<HookRef, { id?: string; uri: string | null; active: boolean }>(({ id, uri, active }, ref) => {
  const result = useArtTint(id, uri, active);
  useImperativeHandle(ref, () => ({ get: () => result }), [result]);
  return null;
});
Harness.displayName = "Harness";

async function settle() {
  for (let i = 0; i < 4; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function mount(props: { id?: string; uri: string | null; active: boolean }) {
  const ref = React.createRef<HookRef>();
  let tree!: TestRenderer.ReactTestRenderer;
  act(() => {
    tree = TestRenderer.create(<Harness ref={ref} {...props} />);
  });
  return { ref, update: (next: typeof props) => act(() => tree.update(<Harness ref={ref} {...next} />)) };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoad.mockResolvedValue({ release: jest.fn() });
  mockHash.mockResolvedValue("00M_AE");
});

it("reads a thumbnail's 1x1 blurhash while active, releases the ref, and serves the cache afterwards", async () => {
  const release = jest.fn();
  mockLoad.mockResolvedValue({ release });
  const { ref, update } = mount({ id: "p1", uri: "poster:p1", active: true });
  expect(ref.current!.get()).toBeNull();
  await settle();
  expect(mockLoad).toHaveBeenCalledWith("poster:p1", { maxHeight: 48 });
  expect(mockHash).toHaveBeenCalledWith({ release }, [1, 1]);
  expect(release).toHaveBeenCalled();
  expect(ref.current!.get()).toMatch(/^\d+, \d+, \d+$/);
  update({ id: "p1", uri: "poster:p1", active: false });
  expect(ref.current!.get()).toBeNull();
  update({ id: "p1", uri: "poster:p1", active: true });
  expect(ref.current!.get()).toMatch(/^\d+, \d+, \d+$/);
  expect(mockLoad).toHaveBeenCalledTimes(1);
});

it("does nothing while inactive or without art", async () => {
  mount({ id: "p2", uri: "poster:p2", active: false });
  mount({ id: "p3", uri: null, active: true });
  await settle();
  expect(mockLoad).not.toHaveBeenCalled();
});

it("remembers a failed read as no tint instead of retrying", async () => {
  mockLoad.mockRejectedValue(new Error("gone"));
  const { ref, update } = mount({ id: "p4", uri: "poster:p4", active: true });
  await settle();
  expect(ref.current!.get()).toBeNull();
  update({ id: "p4", uri: "poster:p4", active: false });
  update({ id: "p4", uri: "poster:p4", active: true });
  await settle();
  expect(mockLoad).toHaveBeenCalledTimes(1);
});
