# Engine test fixtures

`dolbyvision-p81.mkv` is `assets/hevc_tests/regular.mkv` from
[quietvoid/dovi_tool](https://github.com/quietvoid/dovi_tool) (MIT), 256x144 HEVC Main 10,
PQ / BT.2020, carrying a Dolby Vision profile 8.1 configuration record
(`dv_profile 8`, `dv_bl_signal_compatibility_id 1`, `el_present_flag 0`).

The picture is black on every frame (ffmpeg `blackframe` reports `pblack:100` throughout). It
exists to exercise RPU and configuration-record handling, never to judge how anything looks.

`dolbyvision-p7-dual-layer.hevc` is `assets/hevc_tests/regular_start_code_4_muxed_el.hevc` from the
same repository: 1849 NAL units carrying 259 RPUs and 795 enhancement-layer units. Its RPUs are
profile 8, so it is the enhancement-layer fixture, not a conversion one.

Dual layer rides a single track as two unspecified NAL types, 62 the RPU and 63 the enhancement
layer, both on `nuh_layer_id` 0 (`hevcdec.c:3669`, `bsf/dovi_rpu.c:88`). Measured on real disc
content: 12 RPUs and 43 enhancement-layer units across twelve frames, every one on layer 0. A
converter that looked for `nuh_layer_id > 0` would pass every hand-built test and never fire.

`tier-segment.mpegts` is generated, not sourced: two seconds of `testsrc2` at 128x96 as
baseline H.264 with an AAC track, in a transport stream. It is the shape Jellyfin's Slipstream
tier serves, so `TierProbeTests` can hand the engine a segment that really rewraps. The
extension is not `.ts`: the repo's TypeScript compiler reads that as source.

```
ffmpeg -f lavfi -i "testsrc2=size=128x96:rate=12:duration=2" -f lavfi -i "sine=frequency=440:duration=2" \
  -c:v libx264 -preset veryfast -profile:v baseline -pix_fmt yuv420p -g 12 -b:v 80k \
  -c:a aac -b:a 32k -ac 2 -f mpegts tier-segment.mpegts
```

`text-subtitles.mkv` and `text-subtitles.mp4` are generated too, from `a.ass`, `a.ssa` and
`a.srt` beside them. The MKV carries ASS v4.00+ (eng), SSA v4.00 (spa) and SubRip (fra) over a
black 128x96 picture; the MP4 carries the same SubRip cues as mov_text. Matroska stores SSA and
ASS on one codec id, which is why the pair needs a single fixture rather than two.

The ASS track is written for the converter rather than for the eye: a comma inside the dialogue
text, inline `\i`/`\b`/`\u`, a hard `\N` break, a `\pos`-ed sign on a Bold style, a whole line
carried by an Italic style, a `{\p1}` drawing, karaoke `\k`, `<`, `&`, `>`, and a pair of cues
that overlap across a 6s segment boundary.

```
ffmpeg -f lavfi -i "color=c=black:size=128x96:rate=4:duration=30" -i a.ass -i a.ssa -i a.srt \
  -map 0:v -map 1:s -map 2:s -map 3:s -c:v libx264 -preset veryfast -profile:v baseline \
  -pix_fmt yuv420p -g 12 -b:v 12k -c:s copy \
  -metadata:s:s:0 language=eng -metadata:s:s:1 language=spa -metadata:s:s:2 language=fra \
  text-subtitles.mkv

ffmpeg -f lavfi -i "color=c=black:size=128x96:rate=4:duration=15" -i a.srt \
  -map 0:v -map 1:s -c:v libx264 -preset veryfast -profile:v baseline -pix_fmt yuv420p \
  -g 12 -b:v 12k -c:s mov_text -metadata:s:s:0 language=eng text-subtitles.mp4
```

## Profile 5 is not here

FFmpeg cannot write a Dolby Vision configuration record: it does not detect DV in a raw injected
stream, and it drops the record when remuxing a file that has one, both measured. dovi_tool's
corpus ships exactly one container, the profile 8.1 file above. Authoring a profile 5 one needs
`mkvmerge`.

## dolbyvision-rpu/

Bare RPUs from dovi_tool's `assets/tests`, probed with `dovi_tool info` before use:
`fel_orig.bin` and `mel_orig.bin` are `dovi_profile 7` (full and minimal enhancement layer),
`fel_to_81.bin` and `mel_to_81.bin` are the same RPUs converted to profile 8.1.

They are the oracle for `DolbyVisionConverter`. Both cases are needed: MEL carries identity
mapping curves while FEL carries real MMR curves with constants, so a conversion that quietly
flattened the mapping would still pass a MEL-only test.

`p7_real_disc.bin` is twelve consecutive RPUs, 185 bytes each, off a real profile 7 UHD source:
the Dolby Vision Color Accuracy sample listed on [the Kodi wiki](https://kodi.wiki/view/Samples),
ffprobed as `dv_profile 7`, `dv_level 6`, `el_present_flag 1`,
`dv_bl_signal_compatibility_id 6`. The reference RPUs above come from 256x144 test clips; these
carry the metadata an actual 4K library holds. Only the RPUs are here, no picture data.

Format is length-prefixed, 4-byte big-endian size then payload, because an RPU can contain
`00 00 00 01` and start codes would split it in the wrong places.

The conversion runs on our own FFmpeg. Its *encoder* refuses profile 7 outright
(`AVERROR_PATCHWELCOME`, dovi_rpuenc.c:125), but `ff_dovi_rpu_parse` and
`ff_dovi_rpu_generate` are both reachable, and the transformation turned out to be four
fields, read off the reference output rather than from any description of it: the mapping
curves, colour metadata and extension blocks all carry across untouched.

    el_spatial_resampling_filter_flag  1 -> 0
    disable_residual_flag              0 -> 1
    nlq_method_idc              LINEAR_DZ -> NONE
    nlq_pivots                  {0, 1023} -> {0, 0}

`dovi_rpu.h` is FFmpeg-internal and `make install` does not place it, so
`scripts/ffmpeg/build.sh` copies it into the Libavcodec framework alongside the public
headers, and enables the `dovi_rpu` bitstream filter for the object it drags in
(`dovi_rpuenc.o`, which defines the writer).

## The whole-file test

`DolbyVisionEndToEndTests` demuxes a real profile 7 file, runs every video packet through the
production converter, muxes, and re-opens the result. The sample is a 4K disc rip and far too
large to commit, so it skips unless `TOMO_DV_P7_SAMPLE` points at one; `TOMO_DV_P7_OUT` keeps
the converted file instead of writing it to a temporary path.

    TOMO_DV_P7_SAMPLE=/path/to/profile7.mkv swift test --package-path native/ios

Measured on the Color Accuracy sample, ffprobe reading both files:

    source     dv_profile 7  compat 6  el_present 1
    converted  dv_profile 8  compat 1  el_present 0  rpu_present 1

The written file carries one `dvvC` box and an `hvc1` sample entry, which is the pairing
`dolbyVisionSupplementalCodecs` advertises as `dvh1.08.06/db1p`. `dvcC` appears nowhere:
movenc picks the box off the record, `dv_profile > 7` choosing `dvvC` (movenc.c:2507).

## Book fixtures (`books/`)

`fixture-book.pdf`, `fixture-comic.cbz`, `fixture-comic.cbt`, `fixture-comic.cb7` and
`fixture-novel.epub` are generated by `scripts/books/make-fixtures.swift` (run through
`scripts/make-test-books.mjs`): twelve 1200x1600 pages carrying their page number and a
distinct shape, and a three-chapter EPUB with headings, emphasis, an entity, a break and one
picture. The cbt is plain ustar (the server counts pax headers as pages); the cb7 is written
by `/usr/bin/tar --format 7zip`.

`frankenstein.mobi` and `frankenstein.azw3` are Project Gutenberg #84 (public domain),
`pg84-images.mobi` and `pg84-images-kf8.mobi`: a MOBI 6 file with 35 sections and a KF8 file
with 34, the same text both ways.

`if-an-a-bomb-falls-1951.cbr` is "Comic Book - If An A-Bomb Falls (1951)" from archive.org
(`ComicBook-IfAnA-bombFalls1951`, Creative Commons public domain mark): a RAR v3 archive of
eight GIF pages, the real-world CBR shape.

`libarchive-rar3.rar`, `libarchive-rar5.rar` and `libarchive-lzma2.7z` are
`test_read_format_rar.rar`, `test_read_format_rar5_stored.rar` and
`test_read_format_7zip_lzma2.7z` from libarchive's own test suite (BSD-2-Clause), decoded from
their `.uu` form: the smallest proof that the RAR, RAR5 and LZMA readers are in the build.
