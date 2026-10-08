const { execFileSync } = require("node:child_process");
const path = require("node:path");

function evaluate(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", `import {fixturesPage, fixtureTags} from './scripts/lib/fixtures-page.mjs'; console.log(JSON.stringify(${expression}));`], {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
    }),
  );
}

const file = {
  id: "T85",
  title: "T85 REMUX TrueHD real",
  facts: [
    ["File", "T85 REMUX TrueHD real.mkv", true],
    ["Container", "matroska,webm (Matroska / WebM)"],
  ],
  streams: [
    ["0", "video", "vc1 (SMPTE VC-1), Advanced", "1920x1080", "", "", ""],
    ["1", "audio", "truehd (TrueHD)", "48,000 Hz", "", "<b>title</b>", "default"],
    ["2", "subtitle", "hdmv_pgs_subtitle (HDMV)", "", "", "", ""],
  ],
  sidecars: [{ name: "T85 REMUX TrueHD real.en.srt", bytes: 1514, sha256: "ab", codec: "subrip" }],
};
const live = { id: "L01", title: "Live channel", live: { url: "https://origin.example/live.m3u8" }, expectLine: "Expected lane: On-device remux, validate live." };

describe("fixtures page", () => {
  it("tags a file by its stream codecs, sidecars and container, and a live channel as live HLS", () => {
    expect(evaluate(`fixtureTags(${JSON.stringify(file)})`)).toEqual(["video:vc1", "audio:truehd", "subtitle:hdmv_pgs_subtitle", "subtitle:subrip", "container:matroska,webm"]);
    expect(evaluate(`fixtureTags(${JSON.stringify(live)})`)).toEqual(["container:live HLS"]);
  });

  it("indexes each codec once per fixture with its fixture count", () => {
    const html = evaluate(`fixturesPage({lede: "x", fixtures: [${JSON.stringify(file)}, ${JSON.stringify({ ...file, id: "T86", title: "T86 x" })}, ${JSON.stringify(live)}]})`);
    expect(html).toContain('data-key="audio:truehd">truehd<b>2</b></button>');
    expect(html).toContain('data-key="container:live HLS">live HLS<b>1</b></button>');
    expect(html).toContain("<h2>Subtitle codecs · 2</h2>");
    expect(html).toContain('<span class="count" id="count">3 of 3</span>');
  });

  it("renders every fact, stream and sidecar escaped, and keeps a live channel's origin", () => {
    const html = evaluate(`fixturesPage({lede: "a < b", fixtures: [${JSON.stringify(file)}, ${JSON.stringify(live)}]})`);
    expect(html).toContain('<section class="fx" id="t85" data-tags="video:vc1|audio:truehd|subtitle:hdmv_pgs_subtitle|subtitle:subrip|container:matroska,webm">');
    expect(html).toContain("<h3>T85<span>REMUX TrueHD real</span></h3>");
    expect(html).toContain("<tr><td>File</td><td><code>T85 REMUX TrueHD real.mkv</code></td></tr>");
    expect(html).toContain("<td>&lt;b&gt;title&lt;/b&gt;</td>");
    expect(html).toContain("<code>T85 REMUX TrueHD real.en.srt</code>, 1,514 bytes, SHA-256 <code>ab</code>");
    expect(html).toContain("<p>a &lt; b</p>");
    expect(html).toContain("origin <code>https://origin.example/live.m3u8</code>");
    expect(html).not.toContain("<b>title</b>");
  });
});
