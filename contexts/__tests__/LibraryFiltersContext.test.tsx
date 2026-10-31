/** The context is a binding over services/libraryViews: a read starts the library's server load, a write goes to the service, and a service change re-renders readers. */
import { LibraryFiltersProvider, useLibraryFilters } from "@/contexts/LibraryFiltersContext";
import { EMPTY_FILTERS, type LibraryFilters } from "@/types/jellyfin";
import React from "react";
import { Text } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockViews = new Map<string, LibraryFilters>();
const mockListeners = new Set<() => void>();
const mockLoad = jest.fn(async (_id: string) => {});
const mockEmpty: LibraryFilters = { favorite: false, played: false, unplayed: false, genres: [], artistIds: [], years: [], shuffle: false, sortBy: "SortName", sortOrder: "Ascending" };
jest.mock("@/services/libraryViews", () => ({
  getLibraryView: (id: string) => mockViews.get(id) ?? mockEmpty,
  setLibraryView: (id: string, next: LibraryFilters) => {
    mockViews.set(id, next);
    for (const listener of mockListeners) listener();
  },
  clearLibraryView: (id: string) => {
    mockViews.delete(id);
    for (const listener of mockListeners) listener();
  },
  loadLibraryView: (id: string) => mockLoad(id),
  subscribeLibraryViews: (listener: () => void) => {
    mockListeners.add(listener);
    return () => mockListeners.delete(listener);
  },
}));

function Reader({ id }: { id: string }) {
  const { getFilters } = useLibraryFilters();
  return <Text>{getFilters(id).sortBy}</Text>;
}

type Api = ReturnType<typeof useLibraryFilters>;
function Grab({ onApi }: { onApi: (api: Api) => void }) {
  const api = useLibraryFilters();
  React.useEffect(() => {
    onApi(api);
  }, [api, onApi]);
  return null;
}

describe("LibraryFiltersProvider", () => {
  beforeEach(() => {
    mockViews.clear();
    mockListeners.clear();
    mockLoad.mockClear();
  });

  it("reads the saved view, starts its server load, and re-renders when the service changes", async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    let api!: Api;
    await act(async () => {
      tree = TestRenderer.create(
        <LibraryFiltersProvider>
          <Reader id="lib-1" />
          <Grab onApi={(next) => (api = next)} />
        </LibraryFiltersProvider>,
      );
    });
    expect(tree.root.findByType(Text).props.children).toBe("SortName");
    expect(mockLoad).toHaveBeenCalledWith("lib-1");

    await act(async () => api.setFilters("lib-1", { ...EMPTY_FILTERS, sortBy: "DateCreated" }));
    expect(tree.root.findByType(Text).props.children).toBe("DateCreated");

    await act(async () => api.clearFilters("lib-1"));
    expect(tree.root.findByType(Text).props.children).toBe("SortName");
    await act(async () => tree.unmount());
  });
});
