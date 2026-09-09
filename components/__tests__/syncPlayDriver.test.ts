/**
 * The route rule behind the SyncPlay driver: the player replaces itself and, on phone, the
 * video-info sheet, whose modal presentation gives a screen pushed over it a zero frame.
 */
jest.mock("expo-router", () => ({ useRouter: jest.fn(), usePathname: jest.fn() }));
jest.mock("@/contexts/PlayerSessionContext", () => ({ usePlayerSession: jest.fn() }));
jest.mock("@/services/jellyfinApi", () => ({ fetchItemsByIds: jest.fn() }));
jest.mock("@/services/playQueueManager", () => ({ playQueueManager: {} }));
jest.mock("@/services/syncPlayManager", () => ({ subscribeDriver: jest.fn() }));

import { replacesRoute } from "@/components/sync-play-driver";
import { Platform } from "react-native";

describe("replacesRoute", () => {
  it("replaces the player itself", () => {
    expect(replacesRoute("/player")).toBe(true);
  });

  it("replaces the video-info sheet on phone only", () => {
    expect(replacesRoute("/video-info")).toBe(!Platform.isTV);
  });

  it("pushes from every other route", () => {
    expect(replacesRoute("/")).toBe(false);
    expect(replacesRoute("/syncplay")).toBe(false);
    expect(replacesRoute("/settings")).toBe(false);
  });
});
