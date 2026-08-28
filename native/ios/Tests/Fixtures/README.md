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
layer, both on `nuh_layer_id` 0 (`hevcdec.c:3669`, `bsf/dovi_rpu.c:87`). Measured on real disc
content: 12 RPUs and 43 enhancement-layer units across twelve frames, every one on layer 0. A
converter that looked for `nuh_layer_id > 0` would pass every hand-built test and never fire.

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
(`AVERROR_PATCHWELCOME`, dovi_rpuenc.c:118), but `ff_dovi_rpu_parse` and
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
