/** The tap feedback: a light impact on iPhone, iPad and Mac, nothing on Apple TV, where the module is not built. */
import { tapFeedback } from "@/services/haptics";
import { Platform } from "react-native";

const mockImpact = jest.fn(async (_style: string) => {});
jest.mock("expo-haptics", () => ({ impactAsync: (style: string) => mockImpact(style), ImpactFeedbackStyle: { Light: "light" } }));
const mockDebug = jest.fn();
jest.mock("@/utils/logger", () => ({ logger: { debug: (...args: unknown[]) => mockDebug(...args) } }));

describe("tapFeedback", () => {
  afterEach(() => {
    Object.defineProperty(Platform, "isTV", { value: false, configurable: true });
    jest.clearAllMocks();
  });

  it("plays a light impact", async () => {
    await tapFeedback();
    expect(mockDebug).not.toHaveBeenCalled();
    expect(mockImpact).toHaveBeenCalledWith("light");
  });

  it("never loads the module on Apple TV", async () => {
    Object.defineProperty(Platform, "isTV", { value: true, configurable: true });
    await tapFeedback();
    expect(mockImpact).not.toHaveBeenCalled();
  });
});
