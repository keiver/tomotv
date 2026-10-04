/** The playback suite reads Jellyfin's own log to prove a file the device plays made the server run no ffmpeg. */
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function evaluate(expression) {
  return JSON.parse(
    execFileSync(process.execPath, ["--input-type=module", "-e", `import {serverLogMark, serverJobsSince} from './scripts/playback-regression.mjs'; console.log(JSON.stringify(${expression}));`], {
      cwd: path.resolve(__dirname, "../.."),
      encoding: "utf8",
    }),
  );
}

const transcode = (file) =>
  `[2026-09-29 06:08:28.373 -05:00] [INF] [25] MediaBrowser.MediaEncoding.Transcoding.TranscodeManager: "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg" "-analyzeduration 200M -f matroska -i file:\\"/media/Movies/${file}\\" -map_metadata -1"`;
const extraction = (file) =>
  `[2026-09-29 07:03:48.999 -05:00] [INF] [38] MediaBrowser.MediaEncoding.Subtitles.SubtitleEncoder: "/Applications/Jellyfin.app/Contents/MacOS/ffmpeg" "-nostdin -y -i file:\\"/media/Movies/${file}\\" -copyts"`;
const finished = (file) =>
  `[2026-09-29 07:03:52.100 -05:00] [INF] [38] MediaBrowser.MediaEncoding.Subtitles.SubtitleEncoder: ffmpeg subtitle extraction completed for "file:\\"/media/Movies/${file}\\""`;

describe("Jellyfin server log", () => {
  let dir;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tomotv-serverlog-"));
    fs.writeFileSync(path.join(dir, "log_20260929.log"), `${transcode("T07 before.mkv")}\n`);
    fs.writeFileSync(path.join(dir, "log_20260930.log"), `${transcode("T07 before.mkv")}\n`);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("counts only the ffmpeg starts on this file written after the mark", () => {
    const file = path.join(dir, "log_20260930.log");
    const mark = evaluate(`serverLogMark(${JSON.stringify(dir)})`);
    expect(mark.file).toBe(file);
    fs.appendFileSync(file, [transcode("T40 SERVER.mkv"), extraction("T07 REMUX.mkv"), finished("T07 REMUX.mkv"), transcode("T08 other.mkv")].join("\n") + "\n");
    expect(evaluate(`serverJobsSince(${JSON.stringify(mark)}, "/any/T07 REMUX.mkv")`)).toEqual({ transcodes: 0, extractions: 1 });
    expect(evaluate(`serverJobsSince(${JSON.stringify(mark)}, "/any/T40 SERVER.mkv")`)).toEqual({ transcodes: 1, extractions: 0 });
    expect(evaluate(`serverJobsSince(${JSON.stringify(mark)}, "/any/T07 before.mkv")`)).toEqual({ transcodes: 0, extractions: 0 });
  });

  it("answers nothing without a log or a file to look for", () => {
    expect(evaluate(`serverLogMark(${JSON.stringify(path.join(dir, "missing"))})`)).toBeNull();
    const mark = evaluate(`serverLogMark(${JSON.stringify(dir)})`);
    expect(evaluate(`serverJobsSince(${JSON.stringify(mark)}, null)`)).toBeNull();
  });
});
