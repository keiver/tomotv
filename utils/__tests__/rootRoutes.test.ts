import { tabsAvailable, unwindToLibrary } from "../rootRoutes";

const read = { hydrated: true, readyCount: 0 };

describe("tabsAvailable", () => {
  it("keeps the tabs until the saved session has been read", () => {
    expect(tabsAvailable({ isReady: false, isConnected: false }, read)).toBe(true);
  });

  it("keeps the tabs while signed in", () => {
    expect(tabsAvailable({ isReady: true, isConnected: true }, read)).toBe(true);
  });

  it("keeps the tabs until the download manifest has been read", () => {
    expect(tabsAvailable({ isReady: true, isConnected: false }, { hydrated: false, readyCount: 0 })).toBe(true);
  });

  it("keeps the tabs for a signed-out device with a finished download", () => {
    expect(tabsAvailable({ isReady: true, isConnected: false }, { hydrated: true, readyCount: 1 })).toBe(true);
  });

  it("drops the tabs for a signed-out device with nothing downloaded", () => {
    expect(tabsAvailable({ isReady: true, isConnected: false }, read)).toBe(false);
  });
});

describe("unwindToLibrary", () => {
  it("pops to the first route before popping to the Library root", () => {
    const calls: string[] = [];
    unwindToLibrary({ dismissAll: () => calls.push("dismissAll"), dismissTo: (href) => calls.push(`dismissTo ${href}`) });
    expect(calls).toEqual(["dismissAll", "dismissTo /"]);
  });
});
