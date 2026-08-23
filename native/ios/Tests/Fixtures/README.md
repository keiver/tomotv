# Engine test fixtures

`dolbyvision-p81.mkv` is `assets/hevc_tests/regular.mkv` from
[quietvoid/dovi_tool](https://github.com/quietvoid/dovi_tool) (MIT), 256x144 HEVC Main 10,
PQ / BT.2020, carrying a Dolby Vision profile 8.1 configuration record
(`dv_profile 8`, `dv_bl_signal_compatibility_id 1`, `el_present_flag 0`).

The picture is black on every frame (ffmpeg `blackframe` reports `pblack:100` throughout). It
exists to exercise RPU and configuration-record handling, never to judge how anything looks.

## Profiles 5 and 7 are not here

Neither has a fixture because neither can be authored with what is installed. FFmpeg cannot
write a Dolby Vision configuration record: it does not detect DV in a raw injected stream, and
it drops the record when remuxing a file that has one, both measured. dovi_tool's corpus ships
exactly one container, the file above. Authoring the other two needs `mkvmerge`.

For profile 7 the corpus does ship bare RPUs, probed and confirmed with `dovi_tool info`:
`assets/tests/fel_orig.bin` and `mel_orig.bin` are `dovi_profile 7` (FEL and MEL), and
`fel_to_81.bin` / `mel_to_81.bin` are the profile 8 conversions. They are the oracle for any
future profile 7 work, and not something our own FFmpeg can reproduce: `dovi_rpuenc.c:118`
returns `AVERROR_PATCHWELCOME` for profiles 4 and 7, "Coding of Dolby Vision enhancement
layers is currently unsupported".
