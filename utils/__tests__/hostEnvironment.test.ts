import { platformLabel } from "../hostEnvironment";

describe("platformLabel", () => {
  it("names tvOS ahead of everything", () => {
    expect(platformLabel(true, false, false, false)).toBe("tvOS");
  });

  it("splits the two Mac builds by isiOSAppOnMac", () => {
    expect(platformLabel(false, true, false, false)).toBe("Mac Catalyst");
    expect(platformLabel(false, true, true, true)).toBe("iPad on Mac");
  });

  it("splits phone and pad off the Mac path", () => {
    expect(platformLabel(false, false, false, true)).toBe("iPadOS");
    expect(platformLabel(false, false, false, false)).toBe("iOS");
  });
});

describe("SUITE_LINKS_ENABLED", () => {
  const global = globalThis as { __DEV__?: boolean };
  const devFlag = global.__DEV__;
  afterEach(() => {
    global.__DEV__ = devFlag;
  });

  function load(isDev: boolean, isSimulator: boolean): { IS_SIMULATOR: boolean; SUITE_LINKS_ENABLED: boolean } {
    global.__DEV__ = isDev;
    let loaded: { IS_SIMULATOR: boolean; SUITE_LINKS_ENABLED: boolean } | undefined;
    jest.isolateModules(() => {
      jest.doMock("react-native", () => ({
        Platform: { OS: "ios", isTV: true, isPad: false },
        NativeModules: { DeviceEnvironment: { isMac: false, isiOSAppOnMac: false, isSimulator } },
      }));
      loaded = require("../hostEnvironment");
    });
    return loaded!;
  }

  it("is on in a release build compiled for a simulator", () => {
    expect(load(false, true)).toMatchObject({ IS_SIMULATOR: true, SUITE_LINKS_ENABLED: true });
  });

  it("is off in a release build compiled for a device", () => {
    expect(load(false, false)).toMatchObject({ IS_SIMULATOR: false, SUITE_LINKS_ENABLED: false });
  });

  it("is on in a dev build on a device", () => {
    expect(load(true, false).SUITE_LINKS_ENABLED).toBe(true);
  });
});
