import { NativeModules, Platform } from "react-native";

const mockSetArmed = jest.fn();
const mockRemove = jest.fn();
let mockEmit: (() => void) | null = null;

jest.mock("react-native/Libraries/EventEmitter/NativeEventEmitter", () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    addListener: (_name: string, listener: () => void) => {
      mockEmit = listener;
      return { remove: mockRemove };
    },
  })),
}));

function load(isTV: boolean): typeof import("@/services/remoteTouch") {
  Object.defineProperty(Platform, "isTV", { configurable: true, get: () => isTV });
  let loaded!: typeof import("@/services/remoteTouch");
  jest.isolateModules(() => {
    loaded = require("@/services/remoteTouch");
  });
  return loaded;
}

describe("remote double touch", () => {
  beforeAll(() => {
    NativeModules.RemoteTouch = { setArmed: mockSetArmed, addListener: jest.fn(), removeListeners: jest.fn() };
  });
  afterAll(() => {
    delete NativeModules.RemoteTouch;
  });
  beforeEach(() => {
    mockSetArmed.mockClear();
    mockRemove.mockClear();
    mockEmit = null;
  });

  it("arms the native recognizer with the first listener and removes it with the last", () => {
    const { subscribeRemoteDoubleTouch } = load(true);
    const offFirst = subscribeRemoteDoubleTouch(jest.fn());
    const offSecond = subscribeRemoteDoubleTouch(jest.fn());
    expect(mockSetArmed.mock.calls).toEqual([[true]]);
    offFirst();
    expect(mockSetArmed.mock.calls).toEqual([[true]]);
    offSecond();
    expect(mockSetArmed.mock.calls).toEqual([[true], [false]]);
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });

  it("hands a double touch to every listener", () => {
    const { subscribeRemoteDoubleTouch } = load(true);
    const first = jest.fn();
    const second = jest.fn();
    const offFirst = subscribeRemoteDoubleTouch(first);
    const offSecond = subscribeRemoteDoubleTouch(second);
    mockEmit?.();
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    offFirst();
    offSecond();
  });

  it("does nothing off Apple TV", () => {
    const { subscribeRemoteDoubleTouch } = load(false);
    subscribeRemoteDoubleTouch(jest.fn())();
    expect(mockSetArmed).not.toHaveBeenCalled();
  });
});
