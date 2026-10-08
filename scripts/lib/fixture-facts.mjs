/**
 * The playback fixture inventory's facts, from raw ffprobe JSON. Every value printed is one
 * ffprobe reported; nothing is read off a file name.
 */

const ratio = (r) => {
  const [a, b] = String(r).split("/").map(Number);
  return b ? a / b : NaN;
};
const num = (n) => Number(n).toLocaleString("en-US");
const kbps = (b) => `${num(Math.round(Number(b) / 1000))} kb/s`;
const tag = (s, name) => {
  const k = Object.keys(s.tags ?? {}).find((key) => key.toLowerCase() === name);
  return k ? s.tags[k] : undefined;
};

/** Safe inside a markdown table cell. */
export const cell = (v) =>
  String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\s*\n\s*/g, " ");

/** The playable video stream: cover art is a video stream too. */
export const mainVideo = (raw) => raw.streams.find((s) => s.codec_type === "video" && !s.disposition?.attached_pic);

export function sideData(list = []) {
  const seen = new Set();
  const out = [];
  for (const x of list) {
    const t = x.side_data_type;
    if (t === "Mastering display metadata") {
      const xy = (k) => `${ratio(x[`${k}_x`]).toFixed(4)},${ratio(x[`${k}_y`]).toFixed(4)}`;
      const parts = [];
      if (x.red_x) parts.push(`R(${xy("red")}) G(${xy("green")}) B(${xy("blue")}) WP(${xy("white_point")})`);
      if (x.max_luminance) parts.push(`${+ratio(x.min_luminance).toFixed(4)} to ${+ratio(x.max_luminance).toFixed(4)} cd/m2`);
      out.push(`mastering display ${parts.join(", ")}`.trim());
    } else if (t === "Content light level metadata") out.push(`MaxCLL ${x.max_content}, MaxFALL ${x.max_average}`);
    else if (t === "DOVI configuration record")
      out.push(
        `Dolby Vision profile ${x.dv_profile}, level ${x.dv_level}, BL compatibility id ${x.dv_bl_signal_compatibility_id}, RPU ${x.rpu_present_flag}, EL ${x.el_present_flag}, BL ${x.bl_present_flag}`,
      );
    else if (!seen.has(t)) out.push(t);
    seen.add(t);
  }
  return out;
}

function bitrate(s) {
  if (s.bit_rate) return kbps(s.bit_rate);
  const bps = Object.keys(s.tags ?? {}).find((k) => /^BPS(-|$)/.test(k));
  return bps ? `${kbps(s.tags[bps])} (container statistics tag)` : undefined;
}

/** `frame` is the first decoded frame of this stream, for scan type and HDR metadata. */
export function streamDetail(s, frame) {
  const d = [];
  if (s.codec_type === "video") {
    d.push(`${s.width}x${s.height}`);
    if (s.sample_aspect_ratio && !["1:1", "0:1"].includes(s.sample_aspect_ratio)) d.push(`SAR ${s.sample_aspect_ratio}, DAR ${s.display_aspect_ratio}`);
    d.push(s.pix_fmt);
    if (s.bits_per_raw_sample) d.push(`${s.bits_per_raw_sample}-bit`);
    const fps = ratio(s.avg_frame_rate) || ratio(s.r_frame_rate);
    if (fps) d.push(`${+fps.toFixed(3)} fps`);
    if (frame) d.push(frame.interlaced_frame ? `interlaced, ${frame.top_field_first ? "top" : "bottom"} field first` : "progressive");
    else if (s.field_order && s.field_order !== "unknown") d.push(`field order ${s.field_order}`);
    const color = [
      ["range", s.color_range],
      ["matrix", s.color_space],
      ["transfer", s.color_transfer],
      ["primaries", s.color_primaries],
    ].filter(([, v]) => v);
    if (color.length) d.push(color.map(([k, v]) => `${k} ${v}`).join(", "));
    d.push(...sideData(s.side_data_list), ...sideData(frame?.side_data_list));
  } else if (s.codec_type === "audio") {
    d.push(`${num(s.sample_rate)} Hz`, `${s.channels}ch${s.channel_layout ? ` ${s.channel_layout}` : ""}`, s.sample_fmt);
    const bits = Number(s.bits_per_raw_sample) || s.bits_per_sample;
    if (bits) d.push(`${bits}-bit`);
    d.push(...sideData(s.side_data_list));
  } else if (s.codec_type === "attachment") {
    d.push(tag(s, "filename"), tag(s, "mimetype"));
  }
  if (s.codec_type === "video" || s.codec_type === "audio") d.push(bitrate(s));
  const encoder = tag(s, "encoder");
  if (encoder) d.push(`encoder ${encoder}`);
  return d.filter(Boolean).join(", ");
}

export function codecCell(s) {
  const c = [`${s.codec_name ?? "unknown"}${s.codec_long_name ? ` (${s.codec_long_name})` : ""}`];
  if (s.profile && s.profile !== "unknown") c.push(String(s.profile));
  if (s.level > 0) c.push(`level ${s.level}`);
  if (s.codec_tag_string && !s.codec_tag_string.startsWith("[0]")) c.push(`tag ${s.codec_tag_string}`);
  if (s.mime_codec_string) c.push(s.mime_codec_string);
  return c.join(", ");
}

/** Cells per stream: index, type, codec, detail, language, title, flags. */
export function streamRows(raw, frame) {
  const v = mainVideo(raw);
  return raw.streams.map((s) => {
    const flags = Object.entries(s.disposition ?? {})
      .filter(([, on]) => on === 1)
      .map(([k]) => k);
    return [String(s.index), s.codec_type, codecCell(s), streamDetail(s, s === v ? frame : undefined), tag(s, "language") ?? "", tag(s, "title") ?? "", flags.join(", ")];
  });
}

/** One row per stream, then one per sidecar file. */
export function streamTable(raw, frame, sidecars = []) {
  const L = ["| # | Type | Codec | Detail | Language | Title | Flags |", "| --- | --- | --- | --- | --- | --- | --- |"];
  for (const r of streamRows(raw, frame)) L.push(`| ${r.map(cell).join(" | ")} |`);
  for (const sc of sidecars) L.push(`| sidecar | subtitle | ${cell(sc.codec ?? "unreadable")} | \`${cell(sc.name)}\`, ${num(sc.bytes)} bytes, SHA-256 \`${sc.sha256}\` | | | |`);
  return L;
}

/** Container-level rows for the per-file facts table. */
export function formatRows(raw) {
  const f = raw.format;
  const rows = [["Container", `${f.format_name} (${f.format_long_name})`]];
  if (f.duration) rows.push(["Duration", `${Number(f.duration).toFixed(3)} s`]);
  if (Number(f.start_time)) rows.push(["Start time", `${Number(f.start_time).toFixed(3)} s`]);
  if (f.bit_rate) rows.push(["Overall bitrate", kbps(f.bit_rate)]);
  rows.push(["Streams", String(f.nb_streams)]);
  if (raw.chapters?.length) rows.push(["Chapters", `${raw.chapters.length}: ${raw.chapters.map((c) => `${Number(c.start_time).toFixed(1)}s ${tag(c, "title") ?? ""}`.trim()).join("; ")}`]);
  const tags = Object.entries(f.tags ?? {});
  if (tags.length) rows.push(["Container tags", tags.map(([k, val]) => `${k}=${val}`).join("; ")]);
  return rows;
}

/** Compact cells for the coverage table: every audio stream, subtitle counts by codec, sidecars. */
export function summaryCells(raw, sidecars = []) {
  const v = mainVideo(raw);
  const depth = Number((v?.pix_fmt ?? "").match(/(\d+)(le|be)$/)?.[1]);
  const video = v ? `${v.codec_name}${depth > 8 && depth <= 16 ? ` ${depth}-bit` : ""} ${v.width}x${v.height}` : "audio only";
  const audio = raw.streams.filter((s) => s.codec_type === "audio").map((s) => `${s.codec_name} ${s.channels}ch`);
  const subs = {};
  for (const s of raw.streams.filter((x) => x.codec_type === "subtitle")) subs[s.codec_name] = (subs[s.codec_name] ?? 0) + 1;
  const sub = Object.entries(subs).map(([c, n]) => (n > 1 ? `${c} x${n}` : c));
  if (sidecars.length) sub.push(`${sidecars.length} sidecar ${[...new Set(sidecars.map((s) => s.codec ?? "unreadable"))].join("/")}`);
  return { video, audio: audio.join(" + ") || "none", subtitles: sub.join(" + ") || "none" };
}
