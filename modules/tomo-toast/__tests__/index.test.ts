/** The tomo-toast JS surface: durations, id handling, patch merging, and the no-module fallback. */
import { AccessibilityInfo, Alert } from "react-native";

const announce = jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});

interface FakeNative {
  configure: jest.Mock;
  show: jest.Mock;
  dismiss: jest.Mock;
  dismissAll: jest.Mock;
  addListener: jest.Mock;
  emit: (event: string, body: unknown) => void;
}

function fakeNative(): FakeNative {
  const listeners = new Map<string, (body: unknown) => void>();
  return {
    configure: jest.fn(() => Promise.resolve()),
    show: jest.fn(() => Promise.resolve()),
    dismiss: jest.fn(() => Promise.resolve()),
    dismissAll: jest.fn(() => Promise.resolve()),
    addListener: jest.fn((event: string, cb: (body: unknown) => void) => {
      listeners.set(event, cb);
      return { remove: jest.fn() };
    }),
    emit: (event, body) => listeners.get(event)?.(body),
  };
}

let mockNative: FakeNative | null = null;
jest.mock("@/modules/tomo-toast/native", () => ({
  get nativeToast() {
    return mockNative;
  },
}));

import * as toast from "@/modules/tomo-toast";

function load(native: FakeNative | null): typeof toast {
  mockNative = native;
  toast.dismissAllToasts();
  jest.clearAllMocks();
  return toast;
}

describe("toastDurationMs", () => {
  const { toastDurationMs } = load(null);

  it("floors short text at 3s and caps long text at 7s", () => {
    expect(toastDurationMs("Saved")).toBe(3250);
    expect(toastDurationMs("")).toBe(3000);
    expect(toastDurationMs("x".repeat(200))).toBe(7000);
  });

  it("counts the message and keeps errors up 2s longer", () => {
    expect(toastDurationMs("ab", "cd")).toBe(3200);
    expect(toastDurationMs("ab", "cd", "error")).toBe(5200);
    expect(toastDurationMs("x".repeat(200), "", "error")).toBe(9000);
  });
});

describe("with the native module", () => {
  beforeEach(() => jest.clearAllMocks());

  it("fills in id, kind and duration, and never double-announces", () => {
    const native = fakeNative();
    const { showToast } = load(native);
    const id = showToast({ title: "Guide updated" });
    expect(id).toMatch(/^toast-\d+$/);
    expect(native.show).toHaveBeenCalledWith({ title: "Guide updated", id, kind: "info", durationMs: 3650 });
    expect(announce).not.toHaveBeenCalled();
    expect(showToast({ title: "Again" })).not.toBe(id);
  });

  it("keeps a caller's id and duration", () => {
    const native = fakeNative();
    const { showToast } = load(native);
    expect(showToast({ id: "guide", title: "Downloading", progress: true, durationMs: 1234 })).toBe("guide");
    expect(native.show).toHaveBeenCalledWith(expect.objectContaining({ id: "guide", progress: true, durationMs: 1234 }));
  });

  it("merges an update into the live card and recomputes its duration", () => {
    const native = fakeNative();
    const { showToast, updateToast } = load(native);
    showToast({ id: "guide", title: "Downloading guide", message: "From the server", progress: true });
    updateToast("guide", { title: "Guide updated", progress: false, kind: "success" });
    expect(native.show).toHaveBeenLastCalledWith({
      id: "guide",
      title: "Guide updated",
      message: "From the server",
      progress: false,
      kind: "success",
      durationMs: 3000 + 50 * ("Guide updated".length + "From the server".length),
    });
  });

  it("forgets a card once native reports it dismissed", () => {
    const native = fakeNative();
    const { showToast, updateToast } = load(native);
    showToast({ id: "guide", title: "Downloading guide" });
    native.emit("onDismiss", { id: "guide", reason: "swipe" });
    updateToast("guide", { progress: false });
    expect(native.show).toHaveBeenCalledTimes(1);
  });

  it("forwards dismissals", () => {
    const native = fakeNative();
    const { dismissToast, dismissAllToasts } = load(native);
    dismissToast("guide");
    dismissAllToasts();
    expect(native.dismiss).toHaveBeenCalledWith("guide");
    expect(native.dismissAll).toHaveBeenCalled();
  });
});

describe("without the native module", () => {
  beforeEach(() => jest.clearAllMocks());

  it("announces every toast and alerts only errors", () => {
    const { showToast, isNativeToastAvailable, addToastListener } = load(null);
    expect(isNativeToastAvailable()).toBe(false);
    expect(addToastListener("onShow", jest.fn())).toBeNull();
    showToast({ title: "Guide updated" });
    showToast({ title: "Recording failed", message: "Server unreachable", kind: "error" });
    expect(announce).toHaveBeenNthCalledWith(1, "Guide updated");
    expect(announce).toHaveBeenNthCalledWith(2, "Recording failed. Server unreachable");
    expect(alert).toHaveBeenCalledTimes(1);
    expect(alert).toHaveBeenCalledWith("Recording failed", "Server unreachable");
  });
});
