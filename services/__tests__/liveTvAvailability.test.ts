/** The persisted Live TV presence flag: default, transitions, dedupe, subscription. */
import { getLiveTvAvailability, LIVE_TV_AVAILABILITY_KEY, subscribeLiveTvAvailability, updateLiveTvAvailability } from "@/services/liveTvAvailability";
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

describe("live TV availability", () => {
  afterEach(() => {
    updateLiveTvAvailability(false);
    jest.clearAllMocks();
  });

  it("defaults to false with nothing stored", () => {
    expect(getLiveTvAvailability()).toBe(false);
  });

  it("persists a transition and notifies subscribers", () => {
    const setSpy = jest.spyOn(Settings, "set");
    const listener = jest.fn();
    const unsubscribe = subscribeLiveTvAvailability(listener);

    updateLiveTvAvailability(true);
    expect(getLiveTvAvailability()).toBe(true);
    expect(setSpy).toHaveBeenCalledWith({ [LIVE_TV_AVAILABILITY_KEY]: 1 });
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("skips writes and notifications when the value holds", () => {
    updateLiveTvAvailability(true);
    const setSpy = jest.spyOn(Settings, "set");
    setSpy.mockClear();
    const listener = jest.fn();
    const unsubscribe = subscribeLiveTvAvailability(listener);

    updateLiveTvAvailability(true);
    expect(setSpy).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = jest.fn();
    subscribeLiveTvAvailability(listener)();
    updateLiveTvAvailability(true);
    expect(listener).not.toHaveBeenCalled();
  });
});
