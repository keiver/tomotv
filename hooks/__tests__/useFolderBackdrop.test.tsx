/** The folder colour: on, a folder's backdrop tints its screen; off in Settings, nothing is fetched or shown, and back on it returns. */
import { type FolderBackdropSource, useFolderBackdrop } from "@/hooks/useFolderBackdrop";
import { fetchFolderPreviewItems, fetchItemDetails } from "@/services/jellyfinApi";
import { updateUiPreferences } from "@/services/uiPreferences";
import React, { forwardRef, useImperativeHandle } from "react";
import TestRenderer, { act } from "react-test-renderer";

jest.mock("@/services/jellyfinApi", () => ({
  fetchItemDetails: jest.fn(),
  fetchFolderPreviewItems: jest.fn(),
  getTintUrl: (id: string, kind: string) => `tint://${id}/${kind}`,
  subscribeAuthChange: () => () => {},
}));
jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const mockDetails = fetchItemDetails as jest.Mock;
const mockPreview = fetchFolderPreviewItems as jest.Mock;

type Handle = { get: () => FolderBackdropSource | null };
const Probe = forwardRef<Handle, { folderId: string }>(({ folderId }, ref) => {
  const source = useFolderBackdrop(folderId);
  useImperativeHandle(ref, () => ({ get: () => source }), [source]);
  return null;
});
Probe.displayName = "Probe";

describe("useFolderBackdrop", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDetails.mockResolvedValue({ BackdropImageTags: ["b"] });
    mockPreview.mockResolvedValue([]);
  });
  afterEach(() => act(() => updateUiPreferences({ folderTint: true })));

  it("tints from the folder's backdrop while the folder colour is on", async () => {
    const ref = React.createRef<Handle>();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Probe ref={ref} folderId="f1" />);
    });
    expect(ref.current?.get()).toEqual({ uri: "tint://f1/Backdrop", sharp: true });
    act(() => tree.unmount());
  });

  it("fetches nothing and shows nothing while it is off, and tints again once it is back on", async () => {
    act(() => updateUiPreferences({ folderTint: false }));
    const ref = React.createRef<Handle>();
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<Probe ref={ref} folderId="f1" />);
    });
    expect(mockDetails).not.toHaveBeenCalled();
    expect(ref.current?.get()).toBeNull();

    await act(async () => updateUiPreferences({ folderTint: true }));
    expect(mockDetails).toHaveBeenCalledTimes(1);
    expect(ref.current?.get()).toEqual({ uri: "tint://f1/Backdrop", sharp: true });

    await act(async () => updateUiPreferences({ folderTint: false }));
    expect(ref.current?.get()).toBeNull();
    act(() => tree.unmount());
  });
});
