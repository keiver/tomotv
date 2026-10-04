/** What a master playlist's CODECS attribute needs to know about a video stream. */
export interface VideoStreamInfo {
  /** ffprobe's codec name: h264, hevc, av1. */
  codec?: string;
  /** ffprobe's profile string: "High", "Main 10". */
  profile?: string;
  /** H.264/HEVC level as the container declares it (31 for 3.1), AV1 seq_level_idx. */
  level?: number;
  bitDepth?: number;
  dolbyVision?: {
    profile?: number;
    level?: number;
    rpuPresent?: boolean;
    elPresent?: boolean;
    blSignalCompatibilityId?: number;
  };
}

/**
 * H.264 profile_idc and constraint-flag byte, the `PPCC` of `avc1.PPCCLL`.
 *
 * ONLY the two profiles proved against a server's own output are listed. Every
 * codec, profile and level combination in the test library was computed with
 * this table and diffed against the string Jellyfin puts in its master playlist
 * for the same file, on files it stream-copies so both describe one bitstream:
 *
 *   High/31 avc1.64001F   High/41 avc1.640029   Main/30 avc1.4D401E
 *   Main/31 avc1.4D401F   Main/51 avc1.4D4033
 *   HEVC Main/93 hvc1.1.4.L93.B0   HEVC Main 10/120 hvc1.2.4.L120.B0
 *
 * Baseline and the High 4:2:x profiles are deliberately absent. A CODECS string
 * AVPlayer disagrees with is a hard rejection of the whole variant, and nothing
 * in the library can prove those, so they get no attribute at all.
 */
const H264_PROFILE_TAG: Record<string, string> = {
  main: "4D40",
  high: "6400",
};

const AV1_CODECS = ["av1", "av01"];

/**
 * RFC 6381 tag for the video the engine will actually serve, or "" when it
 * cannot be stated as fact.
 *
 * Empty whenever the engine will re-encode: VideoTranscoder pins no profile or
 * level, so its VideoToolbox output is not knowable when this playlist is
 * written, and guessing it is the one mistake this attribute punishes.
 */
export function videoCodecTag(video: VideoStreamInfo | undefined, willCopyVideo: boolean): string {
  const level = video?.level ?? 0;
  if (!willCopyVideo || !video || level <= 0) return "";

  const codec = video.codec?.toLowerCase() ?? "";
  const profile = video.profile?.trim().toLowerCase() ?? "";

  if (codec === "h264") {
    const tag = H264_PROFILE_TAG[profile];
    return tag ? `avc1.${tag}${level.toString(16).toUpperCase().padStart(2, "0")}` : "";
  }
  if (codec === "hevc" && profile === "main") return `hvc1.1.4.L${level}.B0`;
  if (codec === "hevc" && profile === "main 10") return `hvc1.2.4.L${level}.B0`;
  // Copied AV1. The level is the sequence header's seq_level_idx verbatim; the
  // bitstream spec forces Main tier ("M") for levels <= 7, and above that the
  // tier bit is not in the metadata, so "M" is the same required-attribute
  // guess the HDR fallback tag makes.
  if (AV1_CODECS.some((known) => codec.startsWith(known)) && profile === "main" && video.bitDepth) {
    return `av01.0.${String(level).padStart(2, "0")}M.${String(video.bitDepth).padStart(2, "0")}`;
  }
  return "";
}

/**
 * SUPPLEMENTAL-CODECS for a Dolby Vision source the engine copies, or "".
 *
 * Profile 8 with BL compatibility 1 (PQ) or 4 (HLG) is single-layer: the base
 * layer IS HDR10 or HLG, so CODECS keeps its hvc1 token and DV rides alongside.
 * A player that ignores the attribute sees exactly the manifest it sees today.
 *
 * Profile 7 is dual-layer, which Apple decodes nowhere, so DolbyVisionConverter
 * rewrites its RPUs to single-layer 8.1 during the copy and it is advertised as
 * what it arrives as, 8.1 / db1p. The engine fails the session if it meets a
 * profile 7 it cannot convert, so this never outruns the stream.
 *
 * Profile 5 is not backward compatible and returns "".
 *
 * `dvh1` rather than `dvhe` because Remuxer tags the sample entry `hvc1`: the
 * two must agree (ISO/IEC 14496-15) or the sample description is misread.
 */
export function dolbyVisionSupplementalCodecs(video: VideoStreamInfo | undefined, willCopyVideo: boolean): string {
  // A re-encode drops the RPU, so the claim would outlive the metadata.
  if (!video || !willCopyVideo) return "";
  const dv = video.dolbyVision;
  if (dv?.rpuPresent !== true) return "";

  const level = dv.level && dv.level > 0 ? dv.level : 6;
  // Converted profile 7 lands on 8.1 whatever compatibility id the source carried.
  if (dv.profile === 7) return `dvh1.08.${String(level).padStart(2, "0")}/db1p`;
  if (dv.profile !== 8 || dv.elPresent === true) return "";

  const brand = dv.blSignalCompatibilityId === 1 ? "db1p" : dv.blSignalCompatibilityId === 4 ? "db4h" : "";
  if (!brand) return "";
  return `dvh1.08.${String(level).padStart(2, "0")}/${brand}`;
}
