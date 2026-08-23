# Engine test fixtures

`dolbyvision-p81.mkv` is `assets/hevc_tests/regular.mkv` from
[quietvoid/dovi_tool](https://github.com/quietvoid/dovi_tool) (MIT), 256x144 HEVC Main 10,
PQ / BT.2020, carrying a Dolby Vision profile 8.1 configuration record
(`dv_profile 8`, `dv_bl_signal_compatibility_id 1`, `el_present_flag 0`).

The picture is black on every frame. It exists to exercise RPU and configuration-record
handling, never to judge how anything looks.
