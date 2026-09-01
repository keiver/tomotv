/**
 * Tests for useShowInFolder, "Show in Folder" on the info panel.
 *
 * The ordering is the point. The panel is a ROOT route and the folder levels live in the tabs'
 * own stack, so a push queued in the same tick as the dismissal is resolved by expo-router
 * against a root state that still holds the panel: it diverges at the root and forks a second
 * (tabs) instance. The pushes must wait for the pop to reach the navigation state.
 *
 * Rendered with react-test-renderer through a null-rendering harness, the same pattern as
 * hooks/__tests__/useFolderPlay.test.tsx.
 */
import { useShowInFolder } from "@/hooks/useShowInFolder";
import { fetchItemFolderPath } from "@/services/jellyfinApi";
import { JellyfinItem } from "@/types/jellyfin";
import React, { forwardRef, useImperativeHandle } from "react";
import { Alert } from "react-native";
import TestRenderer, { act } from "react-test-renderer";

const mockPush = jest.fn();
const mockBack = jest.fn();

/** Stands in for the navigation container: a root state plus the "state" listeners on it. */
let rootState: object = { generation: 1 };
const stateListeners = new Set<() => void>();
const containerRef = {
  isReady: () => true,
  getRootState: () => rootState,
  addListener: (_type: string, callback: () => void) => {
    stateListeners.add(callback);
    return () => stateListeners.delete(callback);
  },
};

/** What the container does when the pop lands: a new state object, then the event. */
function commitPop() {
  rootState = { generation: 2 };
  stateListeners.forEach((listener) => listener());
}

jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useNavigationContainerRef: () => containerRef,
}));

jest.mock("@/services/jellyfinApi", () => ({ fetchItemFolderPath: jest.fn() }));

const mockFolderPath = fetchItemFolderPath as jest.Mock;

type ShowHandle = { show: (item: JellyfinItem, options?: { dismissFirst?: boolean }) => Promise<void> };

const Harness = forwardRef<ShowHandle>((_props, ref) => {
  const showInFolder = useShowInFolder();
  useImperativeHandle(ref, () => ({ show: showInFolder }), [showInFolder]);
  return null;
});
Harness.displayName = "Harness";

function mountHarness(): ShowHandle {
  const ref = React.createRef<ShowHandle>();
  act(() => {
    TestRenderer.create(<Harness ref={ref} />);
  });
  return ref.current!;
}

const photo = { Id: "photo-1", Name: "reference_00011_", Type: "Photo" } as JellyfinItem;

describe("useShowInFolder", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    rootState = { generation: 1 };
    stateListeners.clear();
    mockFolderPath.mockResolvedValue([{ id: "library-1", name: "Home Videos and Photos", type: "folder" }]);
  });

  it("holds the push until the dismissal reaches the navigation state", async () => {
    const harness = mountHarness();
    let done = false;
    await act(async () => {
      void harness.show(photo, { dismissFirst: true }).then(() => {
        done = true;
      });
    });

    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
    expect(done).toBe(false);

    await act(async () => {
      commitPop();
    });

    expect(done).toBe(true);
    expect(mockPush).toHaveBeenCalledWith({
      pathname: "/[folderId]",
      params: {
        folderId: "library-1",
        name: "Home Videos and Photos",
        type: "folder",
        crumbs: JSON.stringify([{ id: "library-1", name: "Home Videos and Photos", type: "folder" }]),
        focusId: "photo-1",
      },
    });
  });

  it("pushes every level, and only the leaf carries focusId", async () => {
    mockFolderPath.mockResolvedValue([
      { id: "library-1", name: "Shows", type: "folder" },
      { id: "series-1", name: "Arrival", type: "folder" },
    ]);
    const harness = mountHarness();
    await act(async () => {
      void harness.show(photo, { dismissFirst: true });
    });
    await act(async () => {
      commitPop();
    });

    expect(mockPush).toHaveBeenCalledTimes(2);
    expect(mockPush.mock.calls[0][0].params.folderId).toBe("library-1");
    expect(mockPush.mock.calls[0][0].params.focusId).toBeUndefined();
    expect(mockPush.mock.calls[1][0].params.folderId).toBe("series-1");
    expect(mockPush.mock.calls[1][0].params.focusId).toBe("photo-1");
  });

  it("pushes straight away when the caller is not on a root route", async () => {
    const harness = mountHarness();
    await act(async () => {
      await harness.show(photo);
    });

    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).toHaveBeenCalledTimes(1);
  });

  it("says so, and dismisses nothing, when the server cannot place the item", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockFolderPath.mockResolvedValue([]);
    const harness = mountHarness();
    await act(async () => {
      await harness.show(photo, { dismissFirst: true });
    });

    expect(alert).toHaveBeenCalled();
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
