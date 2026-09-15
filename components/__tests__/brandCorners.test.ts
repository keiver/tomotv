import { DOCS_URL, docsQrDataUri } from "@/components/brand-corners";

describe("docsQrDataUri", () => {
  it("encodes the setup guide as a transparent PNG", () => {
    expect(DOCS_URL).toBe("https://tomotv.app/");
    const uri = docsQrDataUri();
    expect(uri.startsWith("data:image/png;base64,")).toBe(true);
    expect(uri.length).toBeGreaterThan(1000);
  });

  it("keeps the same image across calls", () => {
    expect(docsQrDataUri()).toBe(docsQrDataUri());
  });
});
