# The On-Device Playback Engine

**Category:** Implementation
**Keywords:** engine, remux, codec, transcode, localRemux, swscale, deinterlace, decline, coverage

The single authority on what plays on the device and what reaches the Jellyfin
server. Written because the engine outran its documentation: the rules lived
across four files, three docs described a version of them that had not been true
for months, and the gaps that produced were invisible until audited.

## Related

- [`CLAUDE-patterns.md`](./CLAUDE-patterns.md) - architecture and the playback flow
- [`CLAUDE-multi-audio.md`](./CLAUDE-multi-audio.md) - the server lane's audio switching
- [`CLAUDE-testing.md`](./CLAUDE-testing.md) - the playback regression suite

---

## The three lanes

| Lane         | What happens                                                                                       | When                                                       |
| ------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `direct`     | Jellyfin's `/stream?Static=true` straight into AVPlayer                                            | Codec and container both native, no subtitles needing help |
| `localRemux` | The engine reads the original file, rewraps or re-encodes on device, serves fMP4 HLS over loopback | Anything AVPlayer cannot open that the device can handle   |
| `transcode`  | Jellyfin re-encodes and serves HLS                                                                 | Only when the engine declines                              |

The product claim is that the middle lane is the common case. Every decline is
a server transcode, which is why each one below has to earn its place.

## Every reason a file reaches the server

`canRemuxLocally()` in `services/localRemux.ts`, in evaluation order. These are
the complete set; nothing else declines.

| Decline                                                                      | Cause                                                                                                                                                |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `native module unavailable`                                                  | Broken build. Logged as a warning, not debug                                                                                                         |
| `no media streams` / `no video codec in metadata` / `no runtime in metadata` | Jellyfin metadata gaps                                                                                                                               |
| `no carriable audio track`                                                   | Every audio track's codec has no decoder in the linked build                                                                                         |
| ~~`no AV1 hardware decode`~~                                                 | **Gone.** AV1 without hardware decode takes the software path through the vendored dav1d, like VP9, at any size. With hardware it is copied instead. |
| `video codec unsupported`                                                    | No decoder in the linked FFmpeg                                                                                                                      |

Plus two from the caller (`hooks/useVideoPlayback.ts`): the transcode latch once
the server lane has been used, and an image-subtitle file keeping its burn-in
when the engine declined for one of the reasons above.

### The engine decides by doing

There is no size gate. `canRemuxLocally` admits every codec in
`TRANSCODABLE_VIDEO_CODECS` at any resolution, depth or field order; whether
this device keeps up is measured by the session itself.

- **Pre-flight.** The producer times every segment it closes
  (`Remuxer.reportThroughput`: wall seconds against the segment's media
  duration, cushion ahead of the playhead, whether the loop slept on its
  read-ahead cap, thermal state) and sends it to JS as `onEngineThroughput`.
  `useVideoPlayback` holds `setStreamUrl` until segment 0's sample arrives. At
  or above realtime, AVPlayer is bound as before. Below it, the session is
  stopped and the server lane opens at the viewer's own preset, with nothing
  on screen to restart: the fallback reason is `engine below realtime`. No
  sample within the engine's own 20 s segment deadline fails the session the
  way it always did.
- **Remembered per file.** `services/engineVerdicts.ts` keeps
  `Documents/engine-verdicts.json`, keyed by server, item and media source. A
  verdict is written only from a clean sample (thermal nominal or fair, no
  download repackage running) and only counts for the build that wrote it.
  The lane pick and `predictPlaybackLane` both consult it, so the second play
  of a remembered file is a server transcode from the first request and the
  info panel and download planner say so.
- **Mid-play.** Samples keep arriving. `engineStarving` (pure, in
  `localRemux.ts`) is true when the last two timed, unthrottled segments of the
  current generation ran below realtime and at most one segment is ahead of the
  player; the hook then moves to the server at the playhead once, directly,
  and records the verdict. No record to date shows a session that passed
  pre-flight falling below realtime later; this is the backstop, in place of
  the STALLED ladder's restart-then-server.
- **8K** needs no rule: the H.264 encoder refuses to open at 7680x4320 and the
  start-time fallback lands on the server, verdict included.

The bench (`npm run bench:transcode`, `scripts/transcode-bench.mjs`,
`app/dev-bench.tsx`) stays the tool that says where a device stands
(`test/playback/bench/`); nothing in the app reads it. The 2021 Apple TV
(`AppleTV6,2`) record: 1440p VP9 and AV1 at 3.6x and 4.2x, 4K24 8-bit at 1.79x
and 2.07x with flat 10 s windows at thermal "serious", 4K 10-bit at 1.19x and
1.55x, 8K encoder refused. VideoToolbox hwaccel decode
(`AV_HWDEVICE_TYPE_VIDEOTOOLBOX`) is unbuilt; the record's decode-only column
says the software decoder, not the encode, is the ceiling on that box.

## What the linked build can actually do

**We build FFmpeg ourselves.** `scripts/ffmpeg/build.sh` compiles upstream
FFmpeg (version pinned in `scripts/ffmpeg/sources.sh`) plus mbedTLS, dav1d,
uavs3d and the libass font stack, for seven slices; CI publishes the
xcframeworks and `scripts/fetch-ffmpeg.js` downloads them against the SHA256s in
`scripts/ffmpeg/ffmpeg-lock.json`. **Nothing compiles on `npm install`.**

**dav1d ships under a private symbol prefix (`tomo_dav1d_`).** `expo-image` pulls
`libavif/libdav1d` into the same binary, and a static link has one flat symbol
namespace, so two versions of `dav1d_*` cross-wire: FFmpeg allocates a context to
one struct layout and reads it with another. `build_dav1d` renames the exported
API through a header generated from `nm`, and the arm kernels through dav1d's own
`PRIVATE_PREFIX`. The build fails if any externally visible `dav1d_` symbol
survives. Do not "simplify" this away: dropping our copy costs on-device AV1,
and dropping expo-image's costs AVIF in the photo viewer.

Before this we took MPVKit's prebuilt FFmpeg, whose configure line made two
choices for mpv that cost us coverage: `--disable-decoders` behind a 60-entry
allowlist, and `--enable-vulkan`, which made its libswscale reference shaderc
and refuse to link on tvOS. Both are gone.

`npm run probe:codecs` prints the truth by `av_codec_iterate`. Never infer it
from symbols: the static archives carry object files for codecs that were never
enabled. The build registers **519 decoders** (271 video, 226 audio, 22
subtitle) and exactly five audio encoders plus the two VideoToolbox video ones.
The output side is pruned hard on purpose: one muxer (`mp4`), one bitstream
filter (`pgs_frame_merge`), a named filter list. Decoders, demuxers and parsers
are left entirely enabled — that is the point of owning the build.

**The allowlists use the names FFPROBE reports**, which is what Jellyfin puts in
`MediaStream.Codec`, not the decoder's own name. These differ and have bitten
before: TSCC decodes through `camtasia` and reports as `tscc`; AVS3 through
`libuavs3d` reports as `avs3`; DivX 3 through `msmpeg4` reports as `msmpeg4v3`;
Musepack through `mpc7`/`mpc8` reports as `musepack7`/`musepack8`; MPEG-4 ALS
through `als` reports as `mp4als`; ATRAC3+ reports as `atrac3p`. G.722 and G.726
report as `adpcm_g722`/`adpcm_g726`, so the `adpcm` prefix covers them.

Matching is `startsWith`, so a prefix that swallows an unsupported sibling is a
bug: bare `avs` is deliberately NOT listed because it would match `avs2`, which
needs libdavs2 and is not built.

Nothing in FFmpeg's native decoder set is out of reach any more. DivX 3, Theora,
DV and Cinepak all decode on device, and so do VVC/H.266, APV, AVS1, RealAudio
sipr, the ATRAC family, QDM2, WavPack and Musepack. What still reaches the
server is the pixel gate and metadata gaps, nothing else. `rawvideo` is
registered and deliberately excluded: uncompressed 1080p is ~1.5 Gbps off the
server.

## The video path, and why it used to be narrow

`native/ios/LocalRemuxer/VideoTranscoder.swift` decodes in software and encodes
with VideoToolbox. Its input contract is the whole story:

- `h264_videotoolbox` accepts **8-bit `yuv420p` or `nv12`, nothing else**.
- With no way to convert, any decoder producing anything else was refused and the
  file went to the server. That is why ProRes (4:2:2 10-bit), MJPEG (full-range
  4:2:2), FFV1 and HuffYUV were unreachable despite having registered decoders.
- **Two conversion paths, and the fast one is not the general one.**
  `yuv420p`, `yuvj420p` and `nv12` are wrapped straight out of the decoder with
  `CVPixelBufferCreateWithPlanarBytes` (no copy) and converted by a
  `VTPixelTransferSession`. That covers every MPEG-2, MPEG-4, VP8/9, WMV, H.263,
  RV and FLV source. `npm run probe:pixel-transfer` proves those three convert.
- **Everything else goes through libswscale**, which is vendored again now that
  we build FFmpeg without Vulkan. This replaced two hand-written interleaves
  that hardcoded 4:2:0 and 4:2:2 chroma geometry. They did not fail on other
  layouts, which is what made them dangerous: ProRes decodes to `yuv422p10` and
  lost half its chroma rows to a hardcoded `h / 2`; DV decodes to `yuv411p` and
  read three quarters of every chroma row out of alignment padding. Both
  returned a plausible, wrong picture. swscale knows all ~200 pixel formats, so
  enabling a decoder no longer means auditing a conversion by hand.
- Deinterlacing runs BEFORE the conversion, on the decoder's own planar
  output, through libavfilter's bwdif.

Encoder choice follows source depth: `h264_videotoolbox` for 8-bit,
`hevc_videotoolbox` with `p010le` for 10-bit. HEVC output needs no special
handling for the playlist — `Remuxer.buildMuxer` applies the `hvc1` sample-entry
tag off the output codec id, and a non-SDR variant already declares an `hvc1`
CODECS token through `hdrFallbackTag`.

### Deinterlacing is bwdif's, inside the frameworks

Interlaced sources go through a `buffer -> bwdif -> buffersink` graph in
`VideoTranscoder` (`mode=send_frame`, parity from the container's field order,
`deint=all`). Two properties are load-bearing:

- **The filter code lives in the FFmpeg frameworks, compiled -O2 whatever the
  app builds at.** The previous hand-written Swift pass ran ~300x slower at
  -Onone (10.8 vs 3333 fps measured), so every Debug build black-screened
  interlaced content and pegged a core: T37 on device, twice. A per-pixel loop
  in app-target Swift can never carry a realtime path.
- **`mode=send_frame` must be explicit.** bwdif's DEFAULT is send_field, one
  frame per field, which doubles the frame rate and breaks the pipeline's
  timing. Read out of vf_bwdif.c, not assumed.

bwdif holds one frame of lookahead, so EAGAIN from the sink is the steady state
and EOF (`av_buffersrc_add_frame(src, nil)`) releases the last frame.
Seek-restart rebuilds the transcoder (`Remuxer.swift`), so no stale filter state
survives a seek.

`yadif_videotoolbox` (Metal GPU) remains a possible upgrade, its own change with
its own comparison. Apple's `kVTDecompressionPropertyKey_FieldMode` only applies
to streams VideoToolbox decodes itself, and our interlaced sources are MPEG-2
decoded in software; `VideoTranscoder.logDecodeSupport()` logs per-device what
VideoToolbox can decode.

## The audio path has no such ceiling

Libswresample **is** vendored, and `AudioTranscoder` runs every decoder's output
through it, choosing the narrowest sample format that holds the source and
preserving the channel layout rather than taking `av_channel_layout_default`
(which would relabel AC-3's 5.1(side) as 5.1(back)). So any registered decoder
can ride the pipeline whatever its format, rate or layout.

Copied untouched: AAC, ALAC, AC-3, E-AC-3, and FLAC whose extradata is exactly a
34-byte STREAMINFO block. AC-3 and E-AC-3 copying is what preserves Atmos, since
JOC rides inside E-AC-3 as side data — the `delay_moov` path in
`Remuxer.buildMuxer` is what makes the fMP4 muxer accept it.

Everything else is decoded and re-encoded to **FLAC**, with AAC only as a
fallback. That is lossless, which is why DTS and TrueHD keep their quality.
MP3 is deliberately in the re-encode set: Apple's HLS spec allows MP3 only in
MPEG-TS segments and AVPlayer refuses an fMP4 with an `.mp3` sample entry.

**One uncarriable track no longer condemns a file.** The carriable tracks are
kept and the rest dropped; only a file with no carriable track at all declines.

## Audio-only files

They run the same pipeline with no video track. `Remuxer.runPipeline` guards on
`hasVideo`: stream selection, rendition building, plan reporting and the seek
rebuild all tolerate its absence, the timing stream becomes the carried audio
track, and every audio frame is independently decodable so any packet opens a
generation. The master playlist omits `VIDEO-RANGE`, `RESOLUTION` and
`FRAME-RATE`, and carries the audio CODECS token alone.

`audioNeedsRewrap()` decides it on the JS side, checking codec **and** container:
AVPlayer decodes Vorbis in nothing, and refuses an Ogg container whatever is
inside it.

## The retry ladder

Three rungs, in order: **direct, engine, server.**

A failed direct play tries the engine before the server. AVPlayer refusing a
file whose codec and container both passed inspection usually means a container
fault, and rewrapping is exactly what fixes that; going straight to the server
re-encoded a whole film to work around a broken wrapper. `directPlayFailedRef`
carries that state, and it appears in **both** the remux condition and the
transcode condition — without the second, a file the engine declines falls back
to direct play and fails identically forever.

## Rules of engagement

1. `ios/` and `tvos/` are generated and gitignored. Native edits go in
   `native/ios/`, and every one needs `npm run prebuild:tv`, which is Keiver's
   command to run, never Claude's.
2. Verify codec availability with `npm run probe:codecs`, never from memory and
   never from `nm`.
3. Every coverage change gets a fixture whose manifest entry flips from
   `transcode` to `localRemux`. That diff is the proof, and it is the only proof
   that distinguishes "the lane works" from "the lane compiles".
