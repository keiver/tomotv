import { DeviceEventEmitter, NativeModules, Platform } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { warn: jest.fn(), info: jest.fn(), debug: jest.fn(), error: jest.fn() } }));
// The emitter's events land on DeviceEventEmitter, so a test can play the native side.
jest.mock("react-native/Libraries/EventEmitter/NativeEventEmitter", () => ({
  __esModule: true,
  default: class {
    addListener(name: string, listener: (event: unknown) => void) {
      return require("react-native").DeviceEventEmitter.addListener(name, listener);
    }
  },
}));

function load(module: object | undefined) {
  let mod!: typeof import("@/services/localNetworkIdentity");
  jest.isolateModules(() => {
    NativeModules.NetworkInfo = module;
    mod = require("@/services/localNetworkIdentity");
  });
  return mod;
}

describe("subscribeNetworkPath", () => {
  const os = Platform.OS;
  beforeEach(() => {
    Platform.OS = "ios";
  });
  afterAll(() => {
    Platform.OS = os;
  });

  it("hands each native path report to the listener until unsubscribed", () => {
    const listener = jest.fn();
    const unsubscribe = load({}).subscribeNetworkPath(listener);
    DeviceEventEmitter.emit("onNetworkPath", { available: false });
    DeviceEventEmitter.emit("onNetworkPath", { available: true });
    expect(listener.mock.calls).toEqual([[false], [true]]);
    unsubscribe();
    DeviceEventEmitter.emit("onNetworkPath", { available: false });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("never calls the listener without the native module", () => {
    const listener = jest.fn();
    load(undefined).subscribeNetworkPath(listener)();
    DeviceEventEmitter.emit("onNetworkPath", { available: false });
    expect(listener).not.toHaveBeenCalled();
  });
});
