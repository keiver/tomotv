const { execFileSync } = require("node:child_process");
const path = require("node:path");

function evaluate(expression) {
  return JSON.parse(
    execFileSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import {cell, mainVideo, sideData, streamDetail, codecCell, streamTable, formatRows, summaryCells} from './scripts/lib/fixture-facts.mjs'; console.log(JSON.stringify(${expression}));`,
      ],
      { cwd: path.resolve(__dirname, "../.."), encoding: "utf8" },
    ),
  );
}

// Shapes copied from ffprobe 9.0.1 output.
const hdrVideo = {
  index: 0,
  codec_type: "video",
  codec_name: "hevc",
  codec_long_name: "H.265 / HEVC (High Efficiency Video Coding)",
  profile: "Main 10",
  level: 120,
  codec_tag_string: "[0][0][0][0]",
  width: 1920,
  height: 804,
  pix_fmt: "yuv420p10le",
  avg_frame_rate: "24/1",
  r_frame_rate: "24/1",
  color_range: "tv",
  color_space: "bt2020nc",
  color_transfer: "smpte2084",
  color_primaries: "bt2020",
  disposition: { default: 1, forced: 0 },
};
const hdrFrame = {
  interlaced_frame: 0,
  side_data_list: [
    { side_data_type: "H.26[45] User Data Unregistered SEI message" },
    { side_data_type: "H.26[45] User Data Unregistered SEI message" },
    {
      side_data_type: "Mastering display metadata",
      red_x: "34000/50000",
      red_y: "16000/50000",
      green_x: "13250/50000",
      green_y: "34500/50000",
      blue_x: "7500/50000",
      blue_y: "3000/50000",
      white_point_x: "15635/50000",
      white_point_y: "16450/50000",
      min_luminance: "1/10000",
      max_luminance: "10000000/10000",
    },
    { side_data_type: "Content light level metadata", max_content: 1000, max_average: 400 },
  ],
};
const audio = (index, codec, channels, extra = {}) => ({ index, codec_type: "audio", codec_name: codec, channels, sample_rate: "48000", sample_fmt: "fltp", disposition: {}, ...extra });
const sub = (index, codec, tags = {}) => ({ index, codec_type: "subtitle", codec_name: codec, disposition: { default: 0, forced: 1 }, tags });

describe("fixture facts", () => {
  it("prints HDR10 metadata from the first frame, each repeated generic side data type once", () => {
    const detail = evaluate(`streamDetail(${JSON.stringify(hdrVideo)}, ${JSON.stringify(hdrFrame)})`);
    expect(detail).toContain("transfer smpte2084, primaries bt2020");
    expect(detail).toContain("mastering display R(0.6800,0.3200) G(0.2650,0.6900) B(0.1500,0.0600) WP(0.3127,0.3290), 0.0001 to 1000 cd/m2");
    expect(detail).toContain("MaxCLL 1000, MaxFALL 400");
    expect(detail.match(/User Data Unregistered/g)).toHaveLength(1);
    expect(detail).toContain("progressive");
  });

  it("names the Dolby Vision configuration record's fields", () => {
    const dovi = { side_data_type: "DOVI configuration record", dv_profile: 7, dv_level: 6, rpu_present_flag: 1, el_present_flag: 1, bl_present_flag: 1, dv_bl_signal_compatibility_id: 6 };
    expect(evaluate(`sideData([${JSON.stringify(dovi)}])`)).toEqual(["Dolby Vision profile 7, level 6, BL compatibility id 6, RPU 1, EL 1, BL 1"]);
  });

  it("reads the scan type off the first frame, and the stream field order only without one", () => {
    const mpeg2 = { index: 0, codec_type: "video", codec_name: "mpeg2video", width: 1280, height: 720, pix_fmt: "yuv420p", avg_frame_rate: "24/1", field_order: "tt" };
    expect(evaluate(`streamDetail(${JSON.stringify(mpeg2)}, {interlaced_frame: 1, top_field_first: 1})`)).toBe("1280x720, yuv420p, 24 fps, interlaced, top field first");
    expect(evaluate(`streamDetail(${JSON.stringify(mpeg2)})`)).toBe("1280x720, yuv420p, 24 fps, field order tt");
  });

  it("falls back to the container's statistics tag for a stream without a bit rate", () => {
    const s = audio(1, "ac3", 6, { tags: { "BPS-eng": "640000" } });
    expect(evaluate(`streamDetail(${JSON.stringify(s)})`)).toContain("640 kb/s (container statistics tag)");
  });

  it("hides an empty fourcc and keeps a real one", () => {
    expect(evaluate(`codecCell(${JSON.stringify(hdrVideo)})`)).toBe("hevc (H.265 / HEVC (High Efficiency Video Coding)), Main 10, level 120");
    expect(evaluate(`codecCell({codec_name: "vc1", codec_long_name: "SMPTE VC-1", profile: "Advanced", level: 3, codec_tag_string: "WVC1"})`)).toBe("vc1 (SMPTE VC-1), Advanced, level 3, tag WVC1");
  });

  it("skips cover art when choosing the video stream", () => {
    const raw = {
      streams: [
        { index: 0, codec_type: "video", codec_name: "mjpeg", disposition: { attached_pic: 1 } },
        { ...hdrVideo, index: 1 },
      ],
    };
    expect(evaluate(`mainVideo(${JSON.stringify(raw)}).index`)).toBe(1);
  });

  it("summarises every audio stream, subtitle counts by codec, and sidecars", () => {
    const raw = { streams: [hdrVideo, audio(1, "truehd", 6), audio(2, "ac3", 2), sub(3, "hdmv_pgs_subtitle"), sub(4, "hdmv_pgs_subtitle"), sub(5, "subrip")] };
    expect(evaluate(`summaryCells(${JSON.stringify(raw)}, [{name: "a.en.srt", codec: "subrip"}])`)).toEqual({
      video: "hevc 10-bit 1920x804",
      audio: "truehd 6ch + ac3 2ch",
      subtitles: "hdmv_pgs_subtitle x2 + subrip + 1 sidecar subrip",
    });
    expect(evaluate(`summaryCells({streams: [${JSON.stringify(audio(0, "flac", 2))}]})`)).toEqual({ video: "audio only", audio: "flac 2ch", subtitles: "none" });
  });

  it("writes one table row per stream with its flags, language and title, then the sidecars", () => {
    const raw = { streams: [hdrVideo, sub(1, "subrip", { language: "eng", title: "English SDH" })] };
    const rows = evaluate(`streamTable(${JSON.stringify(raw)}, undefined, [{name: "x.es.srt", bytes: 1554, sha256: "ab", codec: "subrip"}])`);
    expect(rows).toHaveLength(5);
    expect(rows[2]).toMatch(/^\| 0 \| video \| .* \| default \|$/);
    expect(rows[3]).toBe("| 1 | subtitle | subrip |  | eng | English SDH | forced |");
    expect(rows[4]).toBe("| sidecar | subtitle | subrip | `x.es.srt`, 1,554 bytes, SHA-256 `ab` | | | |");
  });

  it("lists the container's start offset, chapters and tags, and escapes pipes", () => {
    const raw = {
      format: { format_name: "mpeg", format_long_name: "MPEG-PS", duration: "60.01", start_time: "0.532", bit_rate: "4220000", nb_streams: 2, tags: { comment: "a | b" } },
      chapters: [{ start_time: "0.0", tags: { title: "Chapter 1" } }],
    };
    expect(evaluate(`formatRows(${JSON.stringify(raw)})`)).toEqual([
      ["Container", "mpeg (MPEG-PS)"],
      ["Duration", "60.010 s"],
      ["Start time", "0.532 s"],
      ["Overall bitrate", "4,220 kb/s"],
      ["Streams", "2"],
      ["Chapters", "1: 0.0s Chapter 1"],
      ["Container tags", "comment=a | b"],
    ]);
    expect(evaluate(`cell("a | b\\n c")`)).toBe("a \\| b c");
  });
});
