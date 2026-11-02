import { formatOf, hasCues, sniffFormat, toWebVtt } from "@/services/subtitles/convert";

describe("toWebVtt", () => {
  it("turns SRT cues into WebVTT with dotted milliseconds and a header", () => {
    const srt = "﻿1\r\n00:00:01,000 --> 00:00:02,500\r\nHello\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nWorld\r\n";
    const vtt = toWebVtt(srt, "srt");
    expect(vtt).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.500\nHello\n\n2\n00:00:03.000 --> 00:00:04.000\nWorld\n");
    expect(hasCues(vtt as string)).toBe(true);
  });

  it("drops the ASS override blocks an SRT carries and keeps plain braces", () => {
    const srt = "1\n00:00:01,000 --> 00:00:02,000\n{\\an8}Top line\n\n2\n00:00:03,000 --> 00:00:04,000\n{laughs} {\\i1}said{\\i0}\n";
    expect(toWebVtt(srt, "srt")).toBe("WEBVTT\n\n1\n00:00:01.000 --> 00:00:02.000\nTop line\n\n2\n00:00:03.000 --> 00:00:04.000\n{laughs} said\n");
  });

  it("keeps a WebVTT file as it is, byte order mark and CRLF aside", () => {
    expect(toWebVtt("﻿WEBVTT\r\n\r\n00:00:01.000 --> 00:00:02.000\r\nHi\r\n", "vtt")).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n");
  });

  it("keeps ASS dialogue text and drops its styling", () => {
    const ass = [
      "[Script Info]",
      "Title: x",
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
      "Dialogue: 0,0:00:02.50,0:00:04.00,Default,,0,0,0,,{\\an8}Second\\Nline",
      "Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,First, with comma",
    ].join("\n");
    expect(toWebVtt(ass, "ass")).toBe("WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nFirst, with comma\n\n00:00:02.500 --> 00:00:04.000\nSecond\nline\n");
  });

  it("works out the format when the name gives none", () => {
    expect(sniffFormat("WEBVTT\n\n")).toBe("vtt");
    expect(sniffFormat("[Script Info]\n")).toBe("ass");
    expect(sniffFormat("1\n00:00:01,000 --> 00:00:02,000\nx")).toBe("srt");
    expect(toWebVtt("1\n00:00:01,000 --> 00:00:02,000\nx\n", "")).toContain("00:00:01.000 --> 00:00:02.000");
  });

  it("refuses a format it cannot read", () => {
    expect(toWebVtt("anything", "sup")).toBeNull();
  });

  it("reports a file with no timed cue", () => {
    expect(hasCues("WEBVTT\n\n")).toBe(false);
  });
});

describe("formatOf", () => {
  it("reads the extension, lower case", () => {
    expect(formatOf("Some.File.SRT")).toBe("srt");
    expect(formatOf("noext")).toBe("");
  });
});
