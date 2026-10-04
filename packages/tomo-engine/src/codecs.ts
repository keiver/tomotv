/**
 * Video codecs AVPlayer decodes natively, so the remuxer can stream-copy them.
 * The single direct-play registry: an app's codec gate prefix-matches against it.
 */
export const REMUXABLE_CODECS = ["h264", "avc", "hevc", "h265", "hvc1", "hev1"];

/** Same, but only on hardware that reports AV1 decode support at runtime. */
export const AV1_CODECS = ["av1", "av01"];

/**
 * What this device's VideoToolbox opens, measured by the engine (DeviceDecode.swift).
 * H.264 is not listed: every Apple device decodes it.
 */
export type VideoDecodeSupport = {
  hevc: boolean;
  hevcMain10: boolean;
  av1: boolean;
  /** Tallest standard frame the hardware decoder opens: 0 for none, null without an answer. */
  h264MaxHeight: number | null;
  hevcMaxHeight: number | null;
};

/**
 * Video codecs AVPlayer cannot decode but the on-device engine can transcode
 * (software decode + VideoToolbox encode). Every entry is REGISTERED in the
 * linked build, confirmed with `npm run probe:codecs`, which walks
 * av_codec_iterate, never by symbol: the static archives carry object files for
 * codecs that were never enabled.
 *
 * These are the names FFPROBE reports, not the decoder's own name. Three differ:
 * the TSCC decoder is called "camtasia", AVS3 decodes through "libuavs3d" and
 * reports as "avs3", and DivX 3 decodes through "msmpeg4" while ffprobe reports
 * "msmpeg4v3".
 *
 * Substring matching covers family variants (h263p/i, wmv1/2/3, vp6/vp6f/vp6a,
 * rv10-40, mpeg1video, mjpeg/b).
 *
 * `rawvideo` is registered and deliberately excluded: uncompressed 1080p is
 * ~1.5 Gbps off the source, which no LAN makes sense of.
 */
export const TRANSCODABLE_VIDEO_CODECS = [
  // Modern and mainstream
  "vp8",
  "vp9",
  "vp7",
  "vp6",
  "vvc", // H.266. No Apple silicon decodes this in hardware; software + VT encode is the only way it plays at all.
  // Only reached when the hardware cannot decode AV1; where it can, the check
  // below copies the stream instead. libdav1d does the software decode.
  "av1",
  "av01",
  "mpeg1video",
  "mpeg1",
  "mpeg2video",
  "mpeg2",
  "mpeg4",
  "wmv",
  "vc1",
  "h263",
  "h261",
  "flv1",
  "rv10",
  "rv20",
  "rv30",
  "rv40",
  "rv60",
  "svq1",
  "svq3",
  // The four MPVKit's decoder allowlist switched off. Nothing exotic: DivX 3 is
  // the format half the internet was encoded in before H.264, and DV is every
  // camcorder tape ever captured.
  "msmpeg4v1",
  "msmpeg4v2",
  "msmpeg4v3",
  "theora",
  "dvvideo",
  "cinepak",
  // Chinese broadcast standards. avs3 rides libuavs3d; cavs (AVS1) is native.
  // Bare "avs" is NOT listed on purpose: prefix matching would swallow "avs2",
  // which needs libdavs2 and is not in this build.
  "avs3",
  "cavs",
  "apv",
  // Intermediate and lossless. These decode to 4:2:2, 4:4:4 or 10/12-bit, which
  // is why they need the libswscale conversion path rather than the three
  // formats VideoTranscoder wraps directly.
  "prores",
  "dnxhd",
  "cfhd",
  "mjpeg",
  "jpeg2000",
  "jpegls",
  "ffv1",
  "ffvhuff",
  "huffyuv",
  "utvideo",
  "magicyuv",
  "lagarith",
  "sheervideo",
  "v210",
  "v410",
  // Screen capture and QuickTime-era formats
  "indeo2",
  "indeo3",
  "indeo4",
  "indeo5",
  "snow",
  "tscc",
  "tscc2",
  "msvideo1",
  "msrle",
  "qtrle",
  "rpza",
  "smc",
  "truemotion1",
  "truemotion2",
  "vp3",
  "vp4",
  "vp5",
  "dxv",
  "hap",
  "txd",
  "mts2",
  "vmnc",
];

/**
 * Audio codecs the engine can carry. AAC, ALAC, AC-3, E-AC-3 and well-formed
 * FLAC are copied verbatim; everything else here, MP3 included, is decoded and
 * re-encoded to FLAC on device (AudioTranscoder.swift), which is what lets DTS
 * and TrueHD files play locally at all, since AVPlayer cannot decode either.
 *
 * Anything not listed has no decoder in the linked FFmpeg build. `npm run
 * probe:codecs` prints what the build actually registers; do not infer it from
 * symbols, since the static archives carry object files for codecs that were
 * never enabled.
 */
export const REMUXABLE_AUDIO_CODECS = [
  // copied through untouched
  "aac",
  "mp4a",
  "alac",
  // Copied too, and the only formats that leave the device still compressed:
  // Apple TV can bitstream AC-3 and E-AC-3 to a receiver, and Atmos rides inside
  // E-AC-3 as JOC side data, so copying is what preserves it.
  "ac3",
  "ac-3",
  "eac3",
  "ec-3",
  // decoded and re-encoded on device. MP3 is here rather than copied: Apple HLS
  // allows MP3 audio only in MPEG-TS segments, and AVPlayer refuses fMP4 with an
  // .mp3 sample entry outright ("Cannot Open").
  "mp3",
  "dts",
  "dca",
  "truehd",
  "mlp",
  "opus",
  "vorbis",
  "flac",
  "pcm",
  // companions of the transcodable video codecs, decoders verified registered
  // via av_codec_iterate: MPEG-2 content carries MP2, WMV carries WMA
  // (v1/v2/Pro/Lossless all match "wma"), RealMedia carries Cook or Sipr, 3GP
  // carries AMR ("amr" matches amrnb/amrwb), and MiniDisc/PSP-era video carries
  // ATRAC ("atrac" matches atrac1/3/3al/3plus/3plusal/9).
  "mp2",
  "wma",
  "cook",
  "amr",
  "sipr",
  "ralf",
  "atrac",
  // QuickTime-era music, and the lossless formats a music library actually
  // contains. QDM2/QDMC ride old .mov files; WavPack, TAK, Shorten, OptimFROG
  // (osq) and Monkey's Audio are what a ripped collection is stored in.
  // Names here are ffprobe's, which differ from the decoder's for three of
  // these: Musepack decodes through mpc7/mpc8 and reports as "musepack7"/
  // "musepack8", MPEG-4 ALS decodes through "als" and reports as "mp4als", and
  // ATRAC3+ reports as "atrac3p". Prefix matching handles the families.
  "qdm2",
  "qdmc",
  "wavpack",
  "tak",
  "shorten",
  "osq",
  "musepack",
  "mp4als",
  "speex",
  "gsm",
  "nellymoser",
  "twinvq",
  // The rest of what the build registers. Audio has no format ceiling the way
  // video did: AudioTranscoder runs every decoder's output through
  // libswresample, so any registered decoder can ride the pipeline whatever its
  // sample format, rate or layout.
  //
  // "adpcm" is the one that matters in practice: it is the audio of the old
  // AVIs whose Xvid and MS-MPEG4 video the engine already transcodes, and it
  // covers the whole family (~60 decoders) including G.722 and G.726, which
  // ffprobe reports as "adpcm_g722" and "adpcm_g726" rather than under their
  // own names. APE and TTA are lossless music formats; Dolby E is broadcast.
  "adpcm",
  "ape",
  "tta",
  "mp1",
  "dolby_e",
  // Sonic is absent on purpose: its decoder is the build's only experimental
  // one, and nothing here sets strict_std_compliance, so it cannot open.
];

/**
 * Whether the engine can carry one audio track.
 *
 * Prefix match, not substring: family variants still match ("pcm_s16le",
 * "wmav2", "mp4a.40.2", "adpcm_ima_wav"), but unrelated codecs that merely
 * CONTAIN an entry ("atrac3" contains "ac3") do not slip through.
 * Shared by the admission gate and the rendition builder on purpose.
 */
export function isAudioTrackCarriable(codec: string | undefined): boolean {
  const audioCodec = codec?.toLowerCase();
  return !audioCodec || REMUXABLE_AUDIO_CODECS.some((known) => audioCodec.startsWith(known));
}

/** Every codec the engine takes, video copied or decoded and audio carried: the live DeviceProfile. */
export function engineCodecAllowlists(): { video: string[]; audio: string[] } {
  return { video: [...REMUXABLE_CODECS, ...AV1_CODECS, ...TRANSCODABLE_VIDEO_CODECS], audio: [...REMUXABLE_AUDIO_CODECS] };
}
