import { NativeModules } from "react-native";

const mockSetKeyContext = jest.fn();

jest.mock("@/utils/hostEnvironment", () => ({ IS_MAC: true }));

describe("Mac key context on a JS start", () => {
  beforeAll(() => {
    NativeModules.MacKeyCommands = { setKeyContext: mockSetKeyContext };
  });
  afterAll(() => {
    delete NativeModules.MacKeyCommands;
  });
  beforeEach(() => mockSetKeyContext.mockClear());

  it("clears the native key context when the module loads", () => {
    jest.isolateModules(() => {
      require("@/services/macKeyCommands");
    });
    expect(mockSetKeyContext).toHaveBeenCalledTimes(1);
    expect(mockSetKeyContext).toHaveBeenCalledWith("");
  });

  it("still sends the newest claim after the load clears it", () => {
    jest.isolateModules(() => {
      const { claimMacContextKeys } = require("@/services/macKeyCommands");
      const release = claimMacContextKeys("player", "seek");
      expect(mockSetKeyContext).toHaveBeenLastCalledWith("seek");
      release();
      expect(mockSetKeyContext).toHaveBeenLastCalledWith("");
    });
  });
});
