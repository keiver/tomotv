/** When the programme index lands, the Live TV search on screen runs again; a term the viewer moved past gets nothing. */
import { useLiveTvSearchRefresh } from "@/hooks/useLiveTvSearchRefresh";
import type { JellyfinVideoItem } from "@/types/jellyfin";
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockSearch = jest.fn();
const mockListeners = new Set<() => void>();
jest.mock("@/services/jellyfinApi", () => ({
  searchLiveTv: (term: string) => mockSearch(term),
  subscribeLiveTvSearchIndex: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));

const onResults = jest.fn();
function Harness({ term }: { term: string }) {
  useLiveTvSearchRefresh(term, onResults);
  return null;
}
const indexLanded = async () => {
  await act(async () => {
    for (const listener of [...mockListeners]) listener();
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe("useLiveTvSearchRefresh", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockListeners.clear();
  });

  it("runs the term on screen again when the index lands", async () => {
    const game = [{ Id: "g7" }] as JellyfinVideoItem[];
    mockSearch.mockResolvedValue(game);
    act(() => {
      TestRenderer.create(<Harness term=" yankees " />);
    });
    await indexLanded();
    expect(mockSearch).toHaveBeenCalledWith("yankees");
    expect(onResults).toHaveBeenCalledWith("yankees", game);
  });

  it("drops the answer for a term the viewer has already changed, and asks nothing for an empty one", async () => {
    let answer: (items: JellyfinVideoItem[]) => void = () => {};
    mockSearch.mockReturnValue(new Promise<JellyfinVideoItem[]>((resolve) => (answer = resolve)));
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Harness term="yankees" />);
    });
    await indexLanded();
    act(() => tree.update(<Harness term="mets" />));
    await act(async () => answer([{ Id: "g7" } as JellyfinVideoItem]));
    expect(onResults).not.toHaveBeenCalled();
    mockSearch.mockClear();
    act(() => tree.update(<Harness term="" />));
    await indexLanded();
    expect(mockSearch).not.toHaveBeenCalled();
  });

  it("stops listening when the screen goes", () => {
    let tree!: TestRenderer.ReactTestRenderer;
    act(() => {
      tree = TestRenderer.create(<Harness term="yankees" />);
    });
    expect(mockListeners.size).toBe(1);
    act(() => tree.unmount());
    expect(mockListeners.size).toBe(0);
  });
});
