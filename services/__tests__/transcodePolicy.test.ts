/** The server transcoding predicates: the item's server permission, capped by the device level. */
import { linkRungsAllowed, serverTranscodeAllowed } from "@/services/transcodePolicy";
import { updateUiPreferences } from "@/services/uiPreferences";
import type { JellyfinVideoItem } from "@/types/jellyfin";

jest.mock("@/utils/logger", () => ({ logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } }));

const item = (supportsTranscoding?: boolean) => ({ Id: "a", MediaSources: [{ Id: "a", SupportsTranscoding: supportsTranscoding }] }) as JellyfinVideoItem;

describe("transcodePolicy", () => {
  afterEach(() => updateUiPreferences({ serverTranscoding: "linkOrFile" }));

  it("allows everything the server allows at the default level, and nothing the server forbids", () => {
    expect(serverTranscodeAllowed(item(true))).toBe(true);
    expect(linkRungsAllowed(item(true))).toBe(true);
    expect(serverTranscodeAllowed(item(undefined))).toBe(true);
    expect(serverTranscodeAllowed(item(false))).toBe(false);
    expect(linkRungsAllowed(item(false))).toBe(false);
    expect(serverTranscodeAllowed(null)).toBe(true);
  });

  it("keeps the server for files the device cannot play but never for the link at fileOnly", () => {
    updateUiPreferences({ serverTranscoding: "fileOnly" });
    expect(serverTranscodeAllowed(item(true))).toBe(true);
    expect(linkRungsAllowed(item(true))).toBe(false);
    expect(serverTranscodeAllowed(item(false))).toBe(false);
  });

  it("asks the server for nothing at never, whatever the server allows", () => {
    updateUiPreferences({ serverTranscoding: "never" });
    expect(serverTranscodeAllowed(item(true))).toBe(false);
    expect(linkRungsAllowed(item(true))).toBe(false);
    expect(serverTranscodeAllowed(null)).toBe(false);
  });
});
