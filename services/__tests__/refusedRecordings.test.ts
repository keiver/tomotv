/** Refused recordings an account could not delete stay hidden, per server. */
import { getCachedConfig } from "@/services/jellyfin/session";
import { hiddenRefusedRecordings, hideRefusedRecording } from "@/services/refusedRecordings";
import { Settings } from "react-native";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));
jest.mock("@/services/jellyfin/session", () => ({ getCachedConfig: jest.fn() }));

const onServer = (server: string) => jest.mocked(getCachedConfig).mockReturnValue({ server } as ReturnType<typeof getCachedConfig>);

beforeEach(() => Settings.set({ refusedRecordings: undefined }));

describe("refused recordings", () => {
  it("are hidden on the server they were found on, never on another", () => {
    onServer("http://a.example:8096");
    hideRefusedRecording("r1");
    hideRefusedRecording("r1");
    expect([...hiddenRefusedRecordings()]).toEqual(["r1"]);
    onServer("http://b.example:8096");
    expect(hiddenRefusedRecordings().size).toBe(0);
  });

  it("are not kept signed out", () => {
    onServer("");
    hideRefusedRecording("r1");
    expect(hiddenRefusedRecordings().size).toBe(0);
  });
});
