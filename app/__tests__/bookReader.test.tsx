/**
 * The reader's contract with the native renderer and the server: it opens on the page the
 * server's ticks name, renders a window of pages, writes each page it lands on, and marks
 * the last page played.
 */
import React from "react";
import TestRenderer, { act } from "react-test-renderer";

const mockOpenBook = jest.fn();
const mockRenderPage = jest.fn();
const mockCloseBook = jest.fn(async (..._args: any[]) => {});
const mockRelayout = jest.fn();
jest.mock("@/services/bookRenderer", () => ({
  isBookRendererAvailable: () => true,
  openBook: (...args: any[]) => mockOpenBook(...args),
  renderPage: (...args: any[]) => mockRenderPage(...args),
  relayoutBook: (...args: any[]) => mockRelayout(...args),
  closeBook: (...args: any[]) => mockCloseBook(...args),
}));
jest.mock("@/services/books/file", () => ({ ensureBookFile: jest.fn(async () => "file:///cache/books/book-1.cbz") }));
const mockUpdateUserItemData = jest.fn(async (..._args: any[]) => "ok");
jest.mock("@/services/jellyfinApi", () => ({
  fetchItemDetails: jest.fn(async () => ({ Id: "book-1", Name: "Comic", Type: "Book", Path: "/books/Comic.cbz", UserData: { PlaybackPositionTicks: 10000 } })),
  updateUserItemData: (...args: any[]) => mockUpdateUserItemData(...args),
}));
jest.mock("expo-router", () => ({ useLocalSearchParams: () => ({ itemId: "book-1" }), useRouter: () => ({ back: jest.fn(), push: jest.fn() }) }));
jest.mock("@/components/glass-surface", () => ({ GlassSurface: ({ children }: { children?: React.ReactNode }) => children ?? null }));

let mockViewerProps: any = null;
/** Every goTo, with the page count the viewer had rendered when it was asked. */
const mockGoTo = jest.fn();
jest.mock("@/components/page-viewer", () => {
  const ReactActual = require("react");
  const PageViewer = ReactActual.forwardRef((props: any, ref: any) => {
    mockViewerProps = props;
    ReactActual.useImperativeHandle(ref, () => ({ index: () => props.initialIndex, step: jest.fn(), goTo: (...args: unknown[]) => mockGoTo(props.pages, ...args), zoomTo: jest.fn() }));
    return null;
  });
  return { PageViewer, pageViewerStyles: {}, INFO_PILL_RADIUS: 999, VIEWER_CHROME_TINT: "" };
});

import BookReaderScreen from "@/app/book-reader";

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("book reader", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockViewerProps = null;
    mockOpenBook.mockReset().mockResolvedValue({ token: "t1", kind: "fixed", pages: 3, title: "Comic" });
    mockRenderPage.mockReset().mockImplementation(async (_token: string, index: number, zoom: number) => ({ uri: `file:///cache/books/t1/${index}-${zoom}.jpg`, width: 1200, height: 1600 }));
    mockUpdateUserItemData.mockClear();
    mockCloseBook.mockClear();
    mockGoTo.mockClear();
    mockRelayout.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("opens on the page the server's ticks name and renders a window around it", async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<BookReaderScreen />);
    });
    await settle();
    expect(mockOpenBook).toHaveBeenCalledWith(
      "file:///cache/books/book-1.cbz",
      expect.objectContaining({ pageWidth: expect.any(Number), pageHeight: expect.any(Number), fontSize: expect.any(Number) }),
    );
    expect(mockViewerProps.pages).toBe(3);
    expect(mockViewerProps.initialIndex).toBe(1);
    expect(mockRenderPage.mock.calls.map((c) => c[1]).sort()).toEqual([0, 1, 2]);
    await settle();
    expect(mockViewerProps.uriAt(1)).toBe("file:///cache/books/t1/1-1.jpg");
    tree.unmount();
  });

  it("writes the page it lands on and marks the last page played", async () => {
    let tree!: TestRenderer.ReactTestRenderer;
    await act(async () => {
      tree = TestRenderer.create(<BookReaderScreen />);
    });
    await settle();
    await act(async () => {
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(mockUpdateUserItemData).not.toHaveBeenCalled();
    await act(async () => {
      mockViewerProps.onIndexChange(2);
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(mockUpdateUserItemData).toHaveBeenLastCalledWith("book-1", { PlaybackPositionTicks: 0, Played: true });
    await act(async () => {
      mockViewerProps.onIndexChange(0);
      await jest.advanceTimersByTimeAsync(2000);
    });
    expect(mockUpdateUserItemData).toHaveBeenLastCalledWith("book-1", { PlaybackPositionTicks: 0, Played: false });
    tree.unmount();
    await settle();
    expect(mockCloseBook).toHaveBeenCalledWith("t1");
  });

  it("lands a relayout on its page only once the viewer has the new page count", async () => {
    mockOpenBook.mockResolvedValue({ token: "t1", kind: "text", pages: 3, title: "Novel" });
    mockRelayout.mockResolvedValue({ page: 5, pages: 8 });
    await act(async () => {
      TestRenderer.create(<BookReaderScreen />);
    });
    await settle();
    expect(mockViewerProps.pages).toBe(3);

    await act(async () => {
      mockViewerProps.actions.find((action: { key: string }) => action.key === "bigger").onPress();
    });
    await settle();
    expect(mockRelayout).toHaveBeenCalledWith("t1", expect.any(Number), expect.objectContaining({ fontSize: expect.any(Number) }));
    expect(mockViewerProps.pages).toBe(8);
    expect(mockGoTo).toHaveBeenCalledTimes(1);
    expect(mockGoTo).toHaveBeenCalledWith(8, 5, 1, "fade");
  });

  it("swaps in the sharper render once a zoom settles", async () => {
    await act(async () => {
      TestRenderer.create(<BookReaderScreen />);
    });
    await settle();
    await act(async () => {
      mockViewerProps.onZoomSettled(2);
    });
    await settle();
    expect(mockRenderPage).toHaveBeenCalledWith("t1", 1, 2, expect.any(Object));
    expect(mockViewerProps.uriAt(1)).toBe("file:///cache/books/t1/1-2.jpg");
  });
});
