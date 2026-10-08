# Playback fixtures

Every file the playback suite plays, as ffprobe version 9.0.1 reads it, generated 2026-10-04. Stream facts are ffprobe's, scan type and HDR metadata come from the first decoded video frame, and the SHA-256 identifies the exact bytes described. Browsable with a codec index in [`playback-fixtures.html`](playback-fixtures.html); results per file are in [`playback-coverage.md`](playback-coverage.md).

### T01

| | |
| --- | --- |
| File | `T01 DIRECT H264 AAC.mp4` |
| Size | 2,252,313 bytes |
| SHA-256 | `75de47acc8b9b5c6ef56566eeb5072afc3bde0a4ff4ff40962a4b533c126db46` |
| Container | mov,mp4,m4a,3gp,3g2,mj2 (QuickTime / MOV) |
| Duration | 15.047 s |
| Overall bitrate | 1,198 kb/s |
| Streams | 2 |
| Container tags | major_brand=mp42; minor_version=0; compatible_brands=isommp42; creation_time=2013-11-12T06:30:04.000000Z |
| Origin | unverified |
| Expected lane | On-device remux, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, tag avc1, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, 1,002 kb/s | und |  | default |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, tag mp4a, mp4a.40.2 | 44,100 Hz, 2ch stereo, fltp, 192 kb/s | und |  | default |

### T05

| | |
| --- | --- |
| File | `T05 REMUX H264 TrueHD.mkv` |
| Size | 100,430,410 bytes |
| SHA-256 | `d7f84ac483f80cf41bb3846ce5e73514bfd43c5284b2621743ae24d6eec54151` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 58.566 s |
| Overall bitrate | 13,719 kb/s |
| Streams | 3 |
| Container tags | title=Forced Sub Sample; encoder=libebml v1.3.3 + libmatroska v1.4.4; creation_time=2016-03-04T19:37:29.000000Z |
| Origin | unverified |
| Expected lane | On-device remux, validate copy |
| Harness expects | `{"video":"h264","audio":"flac","subtitles":1,"codecs":"avc1.640029,fLaC","tier":"copy"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 41, avc1.640029 | 1920x800, yuv420p, 8-bit, 23.976 fps, progressive, 12,208 kb/s (container statistics tag) | eng |  | default |
| 1 | audio | dts (DCA (DTS Coherent Acoustics)), DTS | 48,000 Hz, 6ch 5.1(side), fltp, 1,536 kb/s | eng |  | default |
| 2 | subtitle | subrip (SubRip subtitle) |  | eng | Forced Subtitles | default, forced |

### T06

| | |
| --- | --- |
| File | `T06 SERVER H264 PGS burnin.mkv` |
| Size | 157,638,873 bytes |
| SHA-256 | `c7124d7a9ab359793713370f53c71956b34b1d208971ca0156d6dd6eb5b4f4f5` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 45.004 s |
| Start time | 0.083 s |
| Overall bitrate | 28,022 kb/s |
| Streams | 3 |
| Container tags | title=Forced Subs Sample; encoder=libebml v1.3.3 + libmatroska v1.4.4; creation_time=2016-03-04T19:51:20.000000Z |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"subtitles":1,"imageSubtitleSets":1}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 41, avc1.640029 | 1920x1080, yuv420p, 8-bit, 23.976 fps, field order progressive, range tv, matrix bt709, transfer bt709, primaries bt709, 24,119 kb/s (container statistics tag) | eng |  | default |
| 1 | audio | truehd (TrueHD) | 48,000 Hz, 6ch 5.1(side), s32, 24-bit, 3,875 kb/s (container statistics tag) | eng | Dolby TrueHD 5.1 | default |
| 2 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  | eng | Forced English Subtitles | default, forced |

### T07

| | |
| --- | --- |
| File | `T07 REMUX H264 AC3 embedded-subs.mkv` |
| Size | 137,505,376 bytes |
| SHA-256 | `ac542c34db076e4ea8d18acb9284b3c89e30e9f9850abbaff5a793b7fcf7e6b3` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 180.083 s |
| Overall bitrate | 6,109 kb/s |
| Streams | 12 |
| Chapters | 8: 0.0s Chapter 01; 103.1s Chapter 02; 148.7s Chapter 03; 349.8s Chapter 04; 437.2s Chapter 05; 472.1s Chapter 06; 678.8s Chapter 07; 744.1s Chapter 08 |
| Container tags | ENCODER=Lavf62.12.100 |
| Origin | blender-open-movie, Sintel, per memories/CLAUDE-testing.md; container retagged by the 2026-08-07 merge |
| Expected lane | On-device remux, validate copy |
| Harness expects | `{"video":"h264","audio":"ac3","subtitles":10}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 41, avc1.640029 | 1280x544, yuv420p, 8-bit, 24 fps, progressive, range tv, matrix bt709, H.26[45] User Data Unregistered SEI message | eng |  |  |
| 1 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s | eng | AC3 5.1 @ 640 Kbps |  |
| 2 | subtitle | subrip (SubRip subtitle) |  | ger |  | default |
| 3 | subtitle | subrip (SubRip subtitle) |  | eng |  |  |
| 4 | subtitle | subrip (SubRip subtitle) |  | spa |  |  |
| 5 | subtitle | subrip (SubRip subtitle) |  | fre |  |  |
| 6 | subtitle | subrip (SubRip subtitle) |  | ita |  |  |
| 7 | subtitle | subrip (SubRip subtitle) |  | dut |  |  |
| 8 | subtitle | subrip (SubRip subtitle) |  | pol |  |  |
| 9 | subtitle | subrip (SubRip subtitle) |  | por |  |  |
| 10 | subtitle | subrip (SubRip subtitle) |  | rus |  |  |
| 11 | subtitle | subrip (SubRip subtitle) |  | vie |  |  |

### T08

| | |
| --- | --- |
| File | `T08 REMUX H264 sidecar-subs.mkv` |
| Size | 137,505,376 bytes |
| SHA-256 | `4574905e4e7a38f972d935e7e2741a554d562257912fd613ae61d059fdd56175` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 180.083 s |
| Overall bitrate | 6,109 kb/s |
| Streams | 12 |
| Chapters | 8: 0.0s Chapter 01; 103.1s Chapter 02; 148.7s Chapter 03; 349.8s Chapter 04; 437.2s Chapter 05; 472.1s Chapter 06; 678.8s Chapter 07; 744.1s Chapter 08 |
| Container tags | ENCODER=Lavf62.12.100 |
| Origin | blender-open-movie, Sintel, per memories/CLAUDE-testing.md; container retagged by the 2026-08-07 merge |
| Expected lane | On-device remux, validate copy |
| Harness expects | `{"video":"h264","audio":"ac3","subtitles":12}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 41, avc1.640029 | 1280x544, yuv420p, 8-bit, 24 fps, progressive, range tv, matrix bt709, H.26[45] User Data Unregistered SEI message | eng |  |  |
| 1 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s | eng | AC3 5.1 @ 640 Kbps |  |
| 2 | subtitle | subrip (SubRip subtitle) |  | ger |  | default |
| 3 | subtitle | subrip (SubRip subtitle) |  | eng |  |  |
| 4 | subtitle | subrip (SubRip subtitle) |  | spa |  |  |
| 5 | subtitle | subrip (SubRip subtitle) |  | fre |  |  |
| 6 | subtitle | subrip (SubRip subtitle) |  | ita |  |  |
| 7 | subtitle | subrip (SubRip subtitle) |  | dut |  |  |
| 8 | subtitle | subrip (SubRip subtitle) |  | pol |  |  |
| 9 | subtitle | subrip (SubRip subtitle) |  | por |  |  |
| 10 | subtitle | subrip (SubRip subtitle) |  | rus |  |  |
| 11 | subtitle | subrip (SubRip subtitle) |  | vie |  |  |
| sidecar | subtitle | subrip | `T08 REMUX H264 sidecar-subs.en.srt`, 1,514 bytes, SHA-256 `4ed7e1f1bc5ff69fe33606960e4c048ba6766237bf33b132fef76e1a92cb64b2` | | | |
| sidecar | subtitle | subrip | `T08 REMUX H264 sidecar-subs.es.srt`, 1,554 bytes, SHA-256 `02672e534f02321121ea2b8cc7fdac634112b6689021d1f8ed01ed26adc0e639` | | | |

### T09

| | |
| --- | --- |
| File | `T09 REMUX multi-audio.mkv` |
| Size | 31,762,747 bytes |
| SHA-256 | `92acdc33bb0b5d7a4d9b0d6ca792230a78c786a30179dc9999cee41c28642842` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 46.665 s |
| Overall bitrate | 5,445 kb/s |
| Streams | 11 |
| Container tags | encoder=libebml v1.0.0 + libmatroska v1.0.0; creation_time=2010-08-21T18:06:43.000000Z; TITLE=Big Buck Bunny - test 8; DATE_RELEASED=2010; COMMENT=Matroska Validation File 8, secondary audio commentary track, misc subtitle tracks |
| Origin | matroska-test-suite, embedded title tag:  |
| Expected lane | On-device remux, validate copy |
| Harness expects | `{"video":"h264","audio":"aac","audioRenditions":2}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), Main, level 31, avc1.4d401f | 1024x576, yuv420p, 8-bit, 24 fps, progressive, range tv, matrix smpte170m, transfer bt709, primaries smpte170m |  |  | default |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, mp4a.40.2 | 48,000 Hz, 2ch stereo, fltp |  |  | default |
| 2 | subtitle | subrip (SubRip subtitle) |  | eng |  | default |
| 3 | subtitle | subrip (SubRip subtitle) |  | hun |  |  |
| 4 | subtitle | subrip (SubRip subtitle) |  | ger |  |  |
| 5 | subtitle | subrip (SubRip subtitle) |  | fre |  |  |
| 6 | subtitle | subrip (SubRip subtitle) |  | spa |  |  |
| 7 | subtitle | subrip (SubRip subtitle) |  | ita |  |  |
| 8 | audio | aac (AAC (Advanced Audio Coding)), LC, mp4a.40.2 | 22,050 Hz, 1ch mono, fltp | eng | Commentary |  |
| 9 | subtitle | subrip (SubRip subtitle) |  | jpn |  |  |
| 10 | subtitle | subrip (SubRip subtitle) |  |  |  |  |

### T10

| | |
| --- | --- |
| File | `T10 REMUX HEVC HDR10 PQ.mkv` |
| Size | 21,588,066 bytes |
| SHA-256 | `4bde2b46a2427e20654fff0450cd53c2334631652604452fcd1b84b8ee1dfbed` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 90.023 s |
| Overall bitrate | 1,918 kb/s |
| Streams | 2 |
| Container tags | title=Cosmos Laundromat: First Cycle; GENRE=; MAJOR_BRAND=isom; MINOR_VERSION=512; COMPATIBLE_BRANDS=isomiso2avc1mp41; track=0; ARTIST=Blender Foundation; ALBUM=; COMMENT=On a desolate island, suicidal sheep Franck meets his fate in a quirky salesman, who offers him the gift of a lifetime. Little does he know that he can only handle so much lifetime. (CC) Blender Foundation \| www.cosmoslaundromat.org; DATE=2015; ENCODER=Lavf62.12.100 |
| Origin | blender-open-movie, embedded title tag: Cosmos Laundromat: First Cycle |
| Expected lane | On-device remux, validate copy |
| Harness expects | `{"video":"hevc","audio":"aac","videoRange":"PQ","codecs":"hvc1.2.4.L120.B0,mp4a.40.2","tier":"copy"}` |
| Skipped | tvOS SIMULATOR rejects the PQ master (NSURLError -1002) and the server HDR transcode too; the PQ path was built against real-device behavior (-12927). Run with --only T10 on a device build to verify. |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | hevc (H.265 / HEVC (High Efficiency Video Coding)), Main 10, level 120 | 1920x804, yuv420p10le, 24 fps, progressive, range tv, matrix bt2020nc, transfer smpte2084, primaries bt2020, H.26[45] User Data Unregistered SEI message, mastering display R(0.6800,0.3200) G(0.2650,0.6900) B(0.1500,0.0600) WP(0.3127,0.3290), 0.0001 to 1000 cd/m2, MaxCLL 1000, MaxFALL 400, encoder Lavc62.28.100 libx265 |  |  | default |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, mp4a.40.2 | 44,100 Hz, 2ch stereo, fltp, encoder Lavc62.28.100 aac |  |  | default |

### T11

| | |
| --- | --- |
| File | `T11 REMUX H264 AAC.mkv` |
| Size | 127,544,984 bytes |
| SHA-256 | `7bb6632bb7017a9d8557924c5ee7d0a23c340c2920e1d61446b2f2fbec0dc3ba` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 180.083 s |
| Overall bitrate | 5,666 kb/s |
| Streams | 3 |
| Chapters | 8: 0.0s Chapter 01; 103.1s Chapter 02; 148.7s Chapter 03; 349.8s Chapter 04; 437.2s Chapter 05; 472.1s Chapter 06; 678.8s Chapter 07; 744.1s Chapter 08 |
| Container tags | ENCODER=Lavf62.12.100 |
| Origin | blender-open-movie, Sintel, per memories/CLAUDE-testing.md; container retagged by the 2026-08-07 merge |
| Expected lane | On-device remux, validate copy |
| Harness expects | `{"video":"h264","audio":"aac","subtitles":1,"codecs":"avc1.640029,mp4a.40.2"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 41, avc1.640029 | 1280x544, yuv420p, 8-bit, 24 fps, progressive, range tv, matrix bt709, H.26[45] User Data Unregistered SEI message | eng |  |  |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, mp4a.40.2 | 48,000 Hz, 2ch stereo, fltp, encoder Lavc61.19.101 aac | eng | AC3 5.1 @ 640 Kbps |  |
| 2 | subtitle | subrip (SubRip subtitle) |  | ger |  |  |

### T20

| | |
| --- | --- |
| File | `T20 DEVTC VP8 Vorbis 1080p.webm` |
| Size | 43,033,601 bytes |
| SHA-256 | `d7bd8cd5f0a7fd2883101c86adceb6a66e89371f67d66623f3504ca414c1f9c0` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 146.126 s |
| Overall bitrate | 2,356 kb/s |
| Streams | 2 |
| Container tags | encoder=Lavf55.48.100 |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | vp8 (On2 VP8), 0, vp8 | 1920x1080, yuv420p, 24 fps, progressive |  |  | default |
| 1 | audio | vorbis (Vorbis), vorbis | 44,100 Hz, 2ch stereo, fltp |  |  | default |

### T21

| | |
| --- | --- |
| File | `T21 DEVTC VP9 Opus 2048x858.webm` |
| Size | 29,214,391 bytes |
| SHA-256 | `13082ab421bd8609c7b9d5aaeff3e756841cbeefc28470f6e966ffd73a9e2484` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 180.021 s |
| Overall bitrate | 1,298 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf62.12.100 |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | vp9 (Google VP9), Profile 0, vp09.00.40.08 | 2048x858, yuv420p, 24 fps, progressive, range tv, matrix bt709 | eng |  | default |
| 1 | audio | opus (Opus (Opus Interactive Audio Codec)), opus | 48,000 Hz, 2ch stereo, fltp | eng |  | default |

### T22

| | |
| --- | --- |
| File | `T22 DEVTC Xvid MP3.avi` |
| Size | 36,745,600 bytes |
| SHA-256 | `4ce94ba68020ee1a571468dd94174fc8d6832719c4534adf75d75298b75977df` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 90.044 s |
| Overall bitrate | 3,265 kb/s |
| Streams | 2 |
| Container tags | artist=Blender Foundation; comment=On a desolate island, suicidal sheep Franck meets his fate in a quirky salesman, who offers him the gift of a lifetime. Little does he know that he can only handle so much lifetime. (CC) Blender Foundation \| www.cosmoslaundromat.org; date=2015; title=Cosmos Laundromat: First Cycle; track=0; software=Lavf62.12.100 |
| Origin | blender-open-movie, embedded title tag: Cosmos Laundromat: First Cycle |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | mpeg4 (MPEG-4 part 2), Simple Profile, level 1, tag xvid, mp4v.20 | 1920x804, yuv420p, 24 fps, progressive, 3,125 kb/s |  |  |  |
| 1 | audio | mp3 (MP3 (MPEG audio layer 3)), tag U[0][0][0], mp4a.40.34 | 44,100 Hz, 2ch stereo, fltp, 128 kb/s |  |  |  |

### T23

| | |
| --- | --- |
| File | `T23 DEVTC MPEG2 MP2 PS.mpg` |
| Size | 70,207,488 bytes |
| SHA-256 | `cbba88aac29f8810b9aeac5f3fd7977b305335eec4b383e8b9d23ba143c73a2a` |
| Container | mpeg (MPEG-PS (MPEG-2 Program Stream)) |
| Duration | 90.018 s |
| Start time | 0.531 s |
| Overall bitrate | 6,239 kb/s |
| Streams | 2 |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | mpeg2video (MPEG-2 video), Main, level 4 | 1920x804, yuv420p, 24 fps, progressive, range tv, CPB properties, AVPanScan |  |  |  |
| 1 | audio | mp2 (MP2 (MPEG audio layer 2)), mp4a.40.33 | 44,100 Hz, 2ch stereo, s16p, 192 kb/s |  |  |  |

### T24

| | |
| --- | --- |
| File | `T24 DEVTC MPEG2 MP2 TS.ts` |
| Size | 72,039,908 bytes |
| SHA-256 | `7841ae111f43266545e5ada1b40786ec2fa29e6381f959eeb75f80780a8ec00d` |
| Container | mpegts (MPEG-TS (MPEG-2 Transport Stream)) |
| Duration | 90.011 s |
| Start time | 1.431 s |
| Overall bitrate | 6,403 kb/s |
| Streams | 2 |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | mpeg2video (MPEG-2 video), Main, level 4, tag [2][0][0][0] | 1920x804, yuv420p, 24 fps, progressive, range tv, CPB properties, AVPanScan |  |  |  |
| 1 | audio | mp2 (MP2 (MPEG audio layer 2)), tag [3][0][0][0], mp4a.40.33 | 44,100 Hz, 2ch stereo, fltp, 192 kb/s | und |  |  |

### T25

| | |
| --- | --- |
| File | `T25 DEVTC WMV2 WMA2.wmv` |
| Size | 43,327,291 bytes |
| SHA-256 | `356020dfe1eac9534e738daca1817798e78a3ce9316b251ec06359a01749ab79` |
| Container | asf (ASF (Advanced / Active Streaming Format)) |
| Duration | 90.092 s |
| Overall bitrate | 3,847 kb/s |
| Streams | 2 |
| Container tags | creation_time=1970-01-01T00:00:00.000000Z; date=2015; track=0; major_brand=isom; minor_version=512; compatible_brands=isomiso2avc1mp41; artist=Blender Foundation; comment=On a desolate island, suicidal sheep Franck meets his fate in a quirky salesman, who offers him the gift of a lifetime. Little does he know that he can only handle so much lifetime. (CC) Blender Foundation \| www.cosmoslaundromat.org; title=Cosmos Laundromat: First Cycle; encoder=Lavf62.12.100 |
| Origin | blender-open-movie, embedded title tag: Cosmos Laundromat: First Cycle |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | wmv2 (Windows Media Video 8), tag WMV2 | 1920x804, yuv420p, 24 fps, progressive |  |  |  |
| 1 | audio | wmav2 (Windows Media Audio 2), tag a[1][0][0] | 44,100 Hz, 2ch, fltp, 128 kb/s |  |  |  |

### T26

| | |
| --- | --- |
| File | `T26 DEVTC WMV3 WMV9.wmv` |
| Size | 2,021,734 bytes |
| SHA-256 | `a4145c073333b2b54d0f8dafaa75366e2e72b9d84f38d5a01294ed3fcf5b7e98` |
| Container | asf (ASF (Advanced / Active Streaming Format)) |
| Duration | 27.080 s |
| Overall bitrate | 597 kb/s |
| Streams | 2 |
| Container tags | Application=Windows Movie Maker 2.1.4026.0; WMFSDKVersion=10.00.00.3802; WMFSDKNeeded=0.0.0.0000; creation_time=2006-01-16T23:14:08.796000Z; IsVBR=0; DeviceConformanceTemplate=MP@ML; WM/WMADRCPeakReference=32767; WM/WMADRCAverageReference=9988 |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | wmav2 (Windows Media Audio 2), tag a[1][0][0] | 44,100 Hz, 2ch, fltp, 64 kb/s | rus |  |  |
| 1 | video | wmv3 (Windows Media Video 9), Main, tag WMV3 | 640x480, yuv420p, 25 fps, progressive, 512 kb/s | rus |  |  |

### T27

| | |
| --- | --- |
| File | `T27 DEVTC VC1 WVC1.wmv` |
| Size | 43,685,583 bytes |
| SHA-256 | `4c8b9575cfbaf4099a0c8c667e7d4f3174ff6c07219960e360dfaafe21d4222d` |
| Container | asf (ASF (Advanced / Active Streaming Format)) |
| Duration | 58.040 s |
| Overall bitrate | 6,021 kb/s |
| Streams | 1 |
| Container tags | creation_time=2006-05-19T18:15:17.359000Z; VBR Peak=9000000; DeviceConformanceTemplate=AP@L3; WMFSDKVersion=11.0.5358.4827; WMFSDKNeeded=0.0.0.0000; IsVBR=1; Buffer Average=200 |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | vc1 (SMPTE VC-1), Advanced, level 3, tag WVC1 | 1440x576, yuv420p, 25 fps, progressive, 6,000 kb/s | eng |  |  |

### T28

| | |
| --- | --- |
| File | `T28 DEVTC FLV1 MP3.flv` |
| Size | 43,481,458 bytes |
| SHA-256 | `b3fa29bf33a1126b674fb8b3de98dd8b2a9b9f8a42bd45112a833d70958c24d2` |
| Container | flv (FLV (Flash Video)) |
| Duration | 90.025 s |
| Overall bitrate | 3,864 kb/s |
| Streams | 2 |
| Container tags | major_brand=isom; minor_version=512; compatible_brands=isomiso2avc1mp41; track=0; artist=Blender Foundation; album=; comment=On a desolate island, suicidal sheep Franck meets his fate in a quirky salesman, who offers him the gift of a lifetime. Little does he know that he can only handle so much lifetime. (CC) Blender Foundation \| www.cosmoslaundromat.org; date=2015; genre=; title=Cosmos Laundromat: First Cycle; encoder=Lavf62.12.100 |
| Origin | blender-open-movie, embedded title tag: Cosmos Laundromat: First Cycle |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | mp3 (MP3 (MPEG audio layer 3)), mp4a.40.34 | 44,100 Hz, 2ch stereo, fltp, 128 kb/s |  |  |  |
| 1 | video | flv1 (FLV / Sorenson Spark / Sorenson H.263 (Flash Video)) | 1920x804, yuv420p, 24 fps, progressive, 200 kb/s |  |  |  |

### T29

| | |
| --- | --- |
| File | `T29 DEVTC H263 AAC.3gp` |
| Size | 15,420,997 bytes |
| SHA-256 | `b5cea1937e01f392d1b127ff421c8c2b2b8e47b9be6267b0974e27f6abde1701` |
| Container | mov,mp4,m4a,3gp,3g2,mj2 (QuickTime / MOV) |
| Duration | 90.000 s |
| Overall bitrate | 1,371 kb/s |
| Streams | 2 |
| Container tags | major_brand=3gp4; minor_version=512; compatible_brands=3gp4isomiso2 |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"aac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h263 (H.263 / H.263-1996, H.263+ / H.263-1998 / H.263 version 2), tag s263 | 704x576, SAR 127:65, DAR 1397:585, yuv420p, 24 fps, progressive, 1,236 kb/s | und |  | default |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, tag mp4a, mp4a.40.2 | 44,100 Hz, 2ch stereo, fltp, 130 kb/s | und |  | default |

### T30

| | |
| --- | --- |
| File | `T30 DEVTC RV40 Cook.rm` |
| Size | 5,150,821 bytes |
| SHA-256 | `00da9dfaa767dbb83b57e40547727ae5d11ad247642e6230c1971d2a127aab32` |
| Container | rm (RealMedia) |
| Duration | 37.732 s |
| Overall bitrate | 1,092 kb/s |
| Streams | 2 |
| Container tags | copyright=(C) 2002; comment=; ASMRuleBook=#($Bandwidth >= 0),Stream0Bandwidth = 64082, Stream1Bandwidth = 935918;; Audiences=1M DSL;; audioMode=music; Creation Date=7/2/2002 13:15:12; Generated By=RealSystem Producer SDK 9.0.0.868 Windows; Modification Date=7/2/2002 13:15:12; videoMode=normal |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | cook (Cook / Cooker / Gecko (RealAudio G2)), tag cook | 44,100 Hz, 2ch stereo, fltp, 64 kb/s |  |  |  |
| 1 | video | rv40 (RealVideo 4.0), tag RV40 | 640x480, yuv420p, 29.97 fps, progressive, 936 kb/s |  |  |  |

### T31

| | |
| --- | --- |
| File | `T31 DEVTC VP6 MP3.avi` |
| Size | 3,035,236 bytes |
| SHA-256 | `8852404f8efebc02d30fabe108aac42ed8b5e63dadbf10f8c520a4c1f9cfb55a` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 134.640 s |
| Overall bitrate | 180 kb/s |
| Streams | 2 |
| Container tags | software=MEncoder dev-CVS-040909-06:00-3.2.2 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | vp6 (On2 VP6), tag VP61 | 320x240, yuv420p, 18 fps, interlaced, bottom field first, 99 kb/s |  |  |  |
| 1 | audio | mp3 (MP3 (MPEG audio layer 3)), tag U[0][0][0], mp4a.40.34 | 16,000 Hz, 2ch stereo, fltp, 73 kb/s |  |  |  |

### T32

| | |
| --- | --- |
| File | `T32 DEVTC ProRes 422.mov` |
| Size | 329,791,249 bytes |
| SHA-256 | `9d69bb2886ac439e7a8b098d091da3c2b2f651c699aa107fe288f94cbfc18c89` |
| Container | mov,mp4,m4a,3gp,3g2,mj2 (QuickTime / MOV) |
| Duration | 60.000 s |
| Overall bitrate | 43,972 kb/s |
| Streams | 2 |
| Container tags | major_brand=qt  ; minor_version=512; compatible_brands=qt  ; encoder=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |
| Skipped | 10-bit plan opens hevc_videotoolbox and the tvOS SIMULATOR has no HEVC encode; same class as T10. Verified playing on device 2026-08-17. Run with --only T32 on a device build. |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | prores (Apple ProRes (iCodec Pro)), HQ, tag apch | 1280x720, yuv422p10le, 10-bit, 24 fps, progressive, range tv, 43,816 kb/s, encoder Lavc61.19.101 prores_ks |  |  | default |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, tag mp4a, mp4a.40.2 | 48,000 Hz, 1ch mono, fltp, 152 kb/s |  |  | default |

### T33

| | |
| --- | --- |
| File | `T33 DEVTC MJPEG 422.avi` |
| Size | 110,529,082 bytes |
| SHA-256 | `62b2237d7f0f4dcea7d2533999326f6dddf823f36e5d111104b571b3c2477115` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 60.000 s |
| Overall bitrate | 14,737 kb/s |
| Streams | 2 |
| Container tags | software=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | mjpeg (Motion JPEG), Baseline, tag MJPG | 1280x720, yuvj422p, 8-bit, 24 fps, progressive, range pc, matrix bt470bg, 13,964 kb/s |  |  |  |
| 1 | audio | pcm_s16le (PCM signed 16-bit little-endian), tag [1][0][0][0] | 48,000 Hz, 1ch, s16, 16-bit, 768 kb/s |  |  |  |

### T34

| | |
| --- | --- |
| File | `T34 DEVTC FFV1 lossless.mkv` |
| Size | 123,734,996 bytes |
| SHA-256 | `83a454ca4911905715844403a6f0c744dc525688be5d42514b388dec8490a162` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 16,498 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | ffv1 (FFmpeg video codec #1), tag FFV1 | 1280x720, yuv422p, 8-bit, 24 fps, progressive, range tv, encoder Lavc61.19.101 ffv1 |  |  |  |
| 1 | audio | flac (FLAC (Free Lossless Audio Codec)), flac | 48,000 Hz, 1ch mono, s16, 16-bit, encoder Lavc61.19.101 flac |  |  |  |

### T35

| | |
| --- | --- |
| File | `T35 DEVTC HuffYUV.avi` |
| Size | 803,947,036 bytes |
| SHA-256 | `25d6568d44bd65a6c8ffab9379954bd0804bc8786eeb112c221cb826169dca16` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 60.000 s |
| Overall bitrate | 107,193 kb/s |
| Streams | 2 |
| Container tags | software=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | huffyuv (HuffYUV), tag HFYU | 1280x720, yuv422p, 24 fps, progressive, 106,484 kb/s |  |  |  |
| 1 | audio | pcm_s16le (PCM signed 16-bit little-endian), tag [1][0][0][0] | 48,000 Hz, 1ch, s16, 16-bit, 768 kb/s |  |  |  |

### T36

| | |
| --- | --- |
| File | `T36 DEVTC VP9 10bit.webm` |
| Size | 13,900,693 bytes |
| SHA-256 | `6307fa6de3e1ae43444115b3b1667a5cb4d54853d7bad9d24a0f4a2a6dfa7888` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.008 s |
| Overall bitrate | 1,853 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"hevc"}` |
| Skipped | 10-bit plan opens hevc_videotoolbox and the tvOS SIMULATOR has no HEVC encode; same class as T10. Verified playing on device 2026-08-17. Run with --only T36 on a device build. |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | vp9 (Google VP9), Profile 2, vp09.02.31.10 | 1280x720, yuv420p10le, 24 fps, progressive, range tv, encoder Lavc61.19.101 libvpx-vp9 |  |  |  |
| 1 | audio | opus (Opus (Opus Interactive Audio Codec)), opus | 48,000 Hz, 1ch mono, fltp, encoder Lavc61.19.101 libopus |  |  |  |

### T37

| | |
| --- | --- |
| File | `T37 DEVTC MPEG2 interlaced.mpg` |
| Size | 31,651,840 bytes |
| SHA-256 | `a706b580c1c3031d8dcbe8d3f8c61875cbf4419dfcf8f875b00e7fc25711d0e0` |
| Container | mpeg (MPEG-PS (MPEG-2 Program Stream)) |
| Duration | 60.010 s |
| Start time | 0.532 s |
| Overall bitrate | 4,220 kb/s |
| Streams | 2 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | mpeg2video (MPEG-2 video), Main, level 6 | 1280x720, yuv420p, 24 fps, interlaced, top field first, range tv, CPB properties, AVPanScan |  |  |  |
| 1 | audio | mp2 (MP2 (MPEG audio layer 2)), mp4a.40.33 | 48,000 Hz, 1ch mono, s16p, 192 kb/s |  |  |  |

### T38

| | |
| --- | --- |
| File | `T38 DEVTC MPEG4 ADPCM.avi` |
| Size | 14,166,430 bytes |
| SHA-256 | `d9a06fdaabe6f83191922d9bf9b54dfba670d0d5c746288d4943df566e9e99d5` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 60.000 s |
| Overall bitrate | 1,889 kb/s |
| Streams | 2 |
| Container tags | software=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | mpeg4 (MPEG-4 part 2), Simple Profile, level 1, tag DX50, mp4v.20 | 1280x720, yuv420p, 24 fps, progressive, 1,520 kb/s |  |  |  |
| 1 | audio | adpcm_ima_wav (ADPCM IMA WAV), tag [17][0][0][0] | 44,100 Hz, 2ch, s16p, 4-bit, 355 kb/s |  |  |  |

### T39

| | |
| --- | --- |
| File | `T39 REMUX mixed carriable audio.mkv` |
| Size | 12,677,772 bytes |
| SHA-256 | `e35e9fdb586224dcbd2f15d2a944dd54a03e2a65c9d3e8a6455f1ef1a4c3e107` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 1,690 kb/s |
| Streams | 3 |
| Container tags | ENCODER=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","audioRenditions":2}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 1ch mono, fltp, 448 kb/s, encoder Lavc61.19.101 ac3 |  |  | default |
| 2 | audio | wavpack (WavPack) | 48,000 Hz, 1ch mono, s16p, 16-bit, encoder Lavc61.19.101 wavpack |  |  |  |

### T90

| | |
| --- | --- |
| File | `T90 DEVTC MPEG2 TS subsync.ts` |
| Size | 32,602,584 bytes |
| SHA-256 | `5013ba7a8ff45f2bd1ba7c60eb3ad10f6e2aa4223ddd98a772ea546207c044aa` |
| Container | mpegts (MPEG-TS (MPEG-2 Transport Stream)) |
| Duration | 60.010 s |
| Start time | 2.820 s |
| Overall bitrate | 4,346 kb/s |
| Streams | 2 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","subtitles":1}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | mpeg2video (MPEG-2 video), Main, level 6, tag [2][0][0][0] | 1280x720, yuv420p, 25 fps, progressive, range tv, CPB properties, AVPanScan |  |  |  |
| 1 | audio | mp2 (MP2 (MPEG audio layer 2)), tag [3][0][0][0], mp4a.40.33 | 48,000 Hz, 1ch mono, fltp, 192 kb/s |  |  |  |
| sidecar | subtitle | subrip | `T90 DEVTC MPEG2 TS subsync.en.srt`, 163 bytes, SHA-256 `39aaac7f655efdf9a973bf2e200ccdf8429323bd6248c248d1462c98fcf0fdbc` | | | |

### T92

| | |
| --- | --- |
| File | `T92 DEVTC AV1.mp4` |
| Size | 12,410,292 bytes |
| SHA-256 | `71c36a56af4c0f081bfface2ccf5956d2e32a3be542568a206ad347e0c61ce6c` |
| Container | mov,mp4,m4a,3gp,3g2,mj2 (QuickTime / MOV) |
| Duration | 60.000 s |
| Overall bitrate | 1,655 kb/s |
| Streams | 2 |
| Container tags | major_brand=isom; minor_version=512; compatible_brands=isomav01iso2mp41; encoder=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | av1 (Alliance for Open Media AV1), Main, level 5, tag av01, av01.0.05M.08 | 1280x720, yuv420p, 24 fps, progressive, range tv, 1,498 kb/s, encoder Lavc61.19.101 libsvtav1 | und |  | default |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, tag mp4a, mp4a.40.2 | 48,000 Hz, 1ch mono, fltp, 152 kb/s | und |  | default |

### T40

| | |
| --- | --- |
| File | `T40 SERVER VP9 8K gate-reject.webm` |
| Size | 147,627,996 bytes |
| SHA-256 | `c68845fe300818a36a277afe6043820ccfc5b2306522e17773b8be2a1e8575d3` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.041 s |
| Overall bitrate | 19,670 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf58.18.104 |
| Origin | unverified |
| Expected lane | Server transcode, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | vp9 (Google VP9), Profile 0, vp09.00.60.08 | 7680x4320, yuv420p, 24 fps, progressive, range tv, matrix bt709, transfer bt709, primaries bt709 | eng |  | default |
| 1 | audio | opus (Opus (Opus Interactive Audio Codec)), opus | 48,000 Hz, 2ch stereo, fltp | eng |  | default |

### T41

| | |
| --- | --- |
| File | `T41 SERVER VP9 10bit gate-reject.webm` |
| Size | 22,900,632 bytes |
| SHA-256 | `b68d54db55570143cf9c67afeab2329d96d9b3df81a373bf11eb929f16031e55` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.008 s |
| Overall bitrate | 3,053 kb/s |
| Streams | 2 |
| Container tags | title=Cosmos Laundromat: First Cycle; GENRE=; MAJOR_BRAND=isom; MINOR_VERSION=512; COMPATIBLE_BRANDS=isomiso2avc1mp41; track=0; ARTIST=Blender Foundation; ALBUM=; COMMENT=On a desolate island, suicidal sheep Franck meets his fate in a quirky salesman, who offers him the gift of a lifetime. Little does he know that he can only handle so much lifetime. (CC) Blender Foundation \| www.cosmoslaundromat.org; DATE=2015; ENCODER=Lavf62.12.100 |
| Origin | blender-open-movie, embedded title tag: Cosmos Laundromat: First Cycle |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"hevc"}` |
| Skipped | 10-bit plan opens hevc_videotoolbox and the SIMULATOR has no HEVC encode; same class as T32/T36. Run with --only T41 on a device build. |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | vp9 (Google VP9), Profile 2, vp09.02.40.10 | 1920x804, yuv420p10le, 24 fps, progressive, range tv, encoder Lavc62.28.100 libvpx-vp9 |  |  | default |
| 1 | audio | opus (Opus (Opus Interactive Audio Codec)), opus | 48,000 Hz, 2ch stereo, fltp, encoder Lavc62.28.100 libopus |  |  | default |

### T42

| | |
| --- | --- |
| File | `T42 SERVER DivX3 no-decoder.avi` |
| Size | 39,004,346 bytes |
| SHA-256 | `33ed0a719e71fd9a06e93aa5b4b523cdbc53a960cb2d86d06c6f2df762915ab4` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 90.044 s |
| Overall bitrate | 3,465 kb/s |
| Streams | 2 |
| Container tags | artist=Blender Foundation; comment=On a desolate island, suicidal sheep Franck meets his fate in a quirky salesman, who offers him the gift of a lifetime. Little does he know that he can only handle so much lifetime. (CC) Blender Foundation \| www.cosmoslaundromat.org; date=2015; title=Cosmos Laundromat: First Cycle; track=0; software=Lavf62.12.100 |
| Origin | blender-open-movie, embedded title tag: Cosmos Laundromat: First Cycle |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | msmpeg4v3 (MPEG-4 part 2 Microsoft variant version 3), tag MP43 | 1920x804, yuv420p, 24 fps, progressive, 3,326 kb/s |  |  |  |
| 1 | audio | mp3 (MP3 (MPEG audio layer 3)), tag U[0][0][0], mp4a.40.34 | 44,100 Hz, 2ch stereo, fltp, 128 kb/s |  |  |  |

### T43

| | |
| --- | --- |
| File | `T43 SERVER H264 PGS short.mkv` |
| Size | 23,644 bytes |
| SHA-256 | `e6c8f93f57d0371603704d7e7b16933e6c4c5df669da42b42a2a84de881e0f27` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 10.010 s |
| Overall bitrate | 19 kb/s |
| Streams | 2 |
| Container tags | encoder=libebml v1.2.2 + libmatroska v1.3.0; creation_time=2013-05-14T23:58:00.000000Z |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"subtitles":1,"imageSubtitleSets":1}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), Main, level 51, avc1.4d4033 | 720x480, yuv420p, 8-bit, 23.976 fps, progressive, H.26[45] User Data Unregistered SEI message |  | Pure white | default |
| 1 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  | default |

### T44

| | |
| --- | --- |
| File | `T44 SERVER Theora SRT subsync.mkv` |
| Size | 129,482,232 bytes |
| SHA-256 | `48410b129222c58e92361496fd24fb71a1d94beb5d6bca2dd0d46f12f5d2bb66` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 90.046 s |
| Start time | 0.023 s |
| Overall bitrate | 11,504 kb/s |
| Streams | 3 |
| Container tags | ENCODER=Lavf61.7.103 |
| Origin | unverified |
| Expected lane | Server transcode, validate subsync |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | asv1 (ASUS V1), tag ASV1 | 1280x720, yuv420p, 24 fps, progressive, range tv, encoder Lavc61.19.101 asv1 |  |  |  |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, mp4a.40.2 | 44,100 Hz, 1ch mono, fltp, encoder Lavc61.19.101 aac |  |  |  |
| 2 | subtitle | subrip (SubRip subtitle) | encoder Lavc61.19.101 srt | eng |  |  |

### T45

| | |
| --- | --- |
| File | `T45 SERVER DivX3 SDH subsync.mkv` |
| Size | 136,212,937 bytes |
| SHA-256 | `d1122e485919a9faa8570ecadc072a6a770c479f0032c7c6f42da917b98fa017` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 90.341 s |
| Overall bitrate | 12,062 kb/s |
| Streams | 3 |
| Container tags | ENCODER=Lavf61.7.103 |
| Origin | unverified |
| Expected lane | Server transcode, validate subsync |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | asv1 (ASUS V1), tag ASV1 | 1280x960, SAR 9:5, DAR 12:5, yuv420p, 23.976 fps, progressive, range tv, matrix bt709, transfer bt709, primaries bt709, 4,613 kb/s (container statistics tag), encoder Lavc61.19.101 asv1 |  |  | default |
| 1 | audio | eac3 (ATSC A/52B (AC-3, E-AC-3)), ec-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s | eng |  | default |
| 2 | subtitle | subrip (SubRip subtitle) |  | eng | English SDH |  |

### T50

| | |
| --- | --- |
| File | `T50 DIRECT audio WAV.wav` |
| Size | 3,249,924 bytes |
| SHA-256 | `971b4163670445c415c6b0fb6813c38093409ecac2f6b4d429ae3574d24ad470` |
| Container | wav (WAV / WAVE (Waveform Audio)) |
| Duration | 18.356 s |
| Overall bitrate | 1,416 kb/s |
| Streams | 1 |
| Container tags | date=2018-03-03; encoder=Adobe Audition CC 2018.0 (Windows); creation_time=18:52:53; time_reference=0 |
| Origin | unverified |
| Expected lane | Direct play, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | pcm_s16le (PCM signed 16-bit little-endian), tag [1][0][0][0] | 44,100 Hz, 2ch, s16, 16-bit, 1,411 kb/s |  |  |  |

### T51

| | |
| --- | --- |
| File | `T51 DIRECT audio MP3 level-up.mp3` |
| Size | 161,942 bytes |
| SHA-256 | `ddbb8ac057f9476c94ede9963655bcfdf64219be4884d683cbc9bb9406322403` |
| Container | mp3 (MP2/3 (MPEG audio layer 2/3)) |
| Duration | 9.600 s |
| Start time | 0.025 s |
| Overall bitrate | 135 kb/s |
| Streams | 1 |
| Container tags | encoder=Lavf61.7.100 |
| Origin | unverified |
| Expected lane | Direct play, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | mp3 (MP3 (MPEG audio layer 3)), mp4a.40.34 | 44,100 Hz, 2ch stereo, fltp, 134 kb/s, encoder Lavc61.19 |  |  |  |

### T52

| | |
| --- | --- |
| File | `T52 DIRECT audio MP3 optimistic.mp3` |
| Size | 2,640,247 bytes |
| SHA-256 | `fed6c4d15bb70948ab4dd45940dee194e85820a66249c2dd23ffb731b5af9e5a` |
| Container | mp3 (MP2/3 (MPEG audio layer 2/3)) |
| Duration | 164.963 s |
| Start time | 0.025 s |
| Overall bitrate | 128 kb/s |
| Streams | 1 |
| Origin | unverified |
| Expected lane | Direct play, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | mp3 (MP3 (MPEG audio layer 3)), mp4a.40.34 | 44,100 Hz, 2ch stereo, fltp, Replay Gain, 128 kb/s, encoder LAME3.99r |  |  |  |

### T53

| | |
| --- | --- |
| File | `T53 DIRECT audio MP3 reel.mp3` |
| Size | 239,220 bytes |
| SHA-256 | `e8aadcdb9cc722b1d4635c20e1481ed3948e46426462bc55112fdab1d6a56181` |
| Container | mp3 (MP2/3 (MPEG audio layer 2/3)) |
| Duration | 14.942 s |
| Overall bitrate | 128 kb/s |
| Streams | 1 |
| Container tags | major_brand=isom; minor_version=512; compatible_brands=isomiso2avc1mp41; encoder=Lavf58.76.100 |
| Origin | unverified |
| Expected lane | Direct play, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | mp3 (MP3 (MPEG audio layer 3)), mp4a.40.34 | 44,100 Hz, 2ch stereo, fltp, 128 kb/s |  |  |  |

### T54

| | |
| --- | --- |
| File | `T54 DIRECT audio OGG.ogg` |
| Size | 1,967,183 bytes |
| SHA-256 | `2dcde69a23577fb98c584ed0ab8ea69c4ec24c86c835fa7bd67c4a3109aa7c3c` |
| Container | ogg (Ogg) |
| Duration | 164.963 s |
| Overall bitrate | 95 kb/s |
| Streams | 1 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | vorbis (Vorbis), vorbis | 44,100 Hz, 2ch stereo, fltp, 96 kb/s, encoder Lavc57.22.100 libvorbis;Lavf57.21.101 |  |  |  |

### T55

| | |
| --- | --- |
| File | `T55 DIRECT audio OGA.oga` |
| Size | 56,491 bytes |
| SHA-256 | `dea04792209fbbc4fda46add379e8f25b296cac767e49891cdd9dbcf2fdea81e` |
| Container | ogg (Ogg) |
| Duration | 3.871 s |
| Overall bitrate | 117 kb/s |
| Streams | 1 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | vorbis (Vorbis), vorbis | 44,100 Hz, 2ch stereo, fltp, 500 kb/s, encoder REAPER |  |  |  |

### T56

| | |
| --- | --- |
| File | `T56 REMUX audio WMA.wma` |
| Size | 1,501,342 bytes |
| SHA-256 | `ccb9ff39b0c6b7244baaccf1d5c66cb4a27c02332eea95708766fcdf620f720b` |
| Container | asf (ASF (Advanced / Active Streaming Format)) |
| Duration | 60.001 s |
| Overall bitrate | 200 kb/s |
| Streams | 1 |
| Container tags | creation_time=1970-01-01T00:00:00.000000Z; encoder=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"audio":"flac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | wmav2 (Windows Media Audio 2), tag a[1][0][0] | 48,000 Hz, 2ch, fltp, 192 kb/s |  |  |  |

### T60

| | |
| --- | --- |
| File | `T60 REMUX AC3 5.1.mkv` |
| Size | 12,739,634 bytes |
| SHA-256 | `224f330acbc4ba2232f28440f736134774dbae86fdac9f2ba794ba770a25c5af` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 1,699 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"ac3","audioChannels":6,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s, encoder Lavc61.19.101 ac3 |  |  |  |

### T61

| | |
| --- | --- |
| File | `T61 REMUX EAC3 5.1.mkv` |
| Size | 13,701,775 bytes |
| SHA-256 | `053f777682906548ea9986647a7390cf302c90ea39ee8ddd6a28616ace027897` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 1,827 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"eac3","audioChannels":6,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | eac3 (ATSC A/52B (AC-3, E-AC-3)), ec-3 | 48,000 Hz, 6ch 5.1(side), fltp, 768 kb/s, encoder Lavc61.19.101 eac3 |  |  |  |

### T62

| | |
| --- | --- |
| File | `T62 REMUX FLAC 7.1 24bit.mkv` |
| Size | 14,183,980 bytes |
| SHA-256 | `9d47f4ff089e628bd4b10c733f3940f5f0fdd0fdcbce2142970b535747f00c72` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 1,891 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac","audioChannels":8,"audioBitDepth":24,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | flac (FLAC (Free Lossless Audio Codec)), flac | 48,000 Hz, 8ch 7.1, s32, 24-bit, encoder Lavc61.19.101 flac |  |  |  |

### T63

| | |
| --- | --- |
| File | `T63 REMUX TrueHD 5.1.mkv` |
| Size | 16,531,518 bytes |
| SHA-256 | `13cc71b501394bface40185a12d0b5d55cbf2ab487a1c977dbf65e3b0823bbf0` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 2,204 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac","audioChannels":6,"audioBitDepth":24,"audioCopy":false}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | truehd (TrueHD) | 48,000 Hz, 6ch 5.1(side), s32, 24-bit, encoder Lavc61.19.101 truehd |  |  |  |

### T64

| | |
| --- | --- |
| File | `T64 REMUX DTS 5.1.mkv` |
| Size | 18,559,692 bytes |
| SHA-256 | `1ea03f6821704faced57f0723dbbf330a96009b527c93f364a3d75bc4ec0f1d1` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 2,475 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac","audioChannels":6,"audioCopy":false}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | dts (DCA (DTS Coherent Acoustics)), DTS | 48,000 Hz, 6ch 5.1(side), fltp, 1,411 kb/s, encoder Lavc61.19.101 dca |  |  |  |

### T65

| | |
| --- | --- |
| File | `T65 REMUX FLAC 5.1 24bit.mkv` |
| Size | 12,634,947 bytes |
| SHA-256 | `37e9933f2863833296b329344f1cfafada6bc33af08da261628425c257b7222e` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 1,685 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac","audioChannels":6,"audioBitDepth":24,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | flac (FLAC (Free Lossless Audio Codec)), flac | 48,000 Hz, 6ch 5.1, s32, 24-bit, encoder Lavc61.19.101 flac |  |  |  |

### T66

| | |
| --- | --- |
| File | `T66 REMUX ALAC 5.1 24bit.mkv` |
| Size | 31,945,252 bytes |
| SHA-256 | `4be8417d12f3dc64b5227596eeb87622b691f7da8baaafe3d1ea9ea2e27a7f36` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 4,259 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"alac","audioChannels":6,"audioBitDepth":24,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | alac (ALAC (Apple Lossless Audio Codec)) | 48,000 Hz, 6ch 5.1, s32p, 24-bit, encoder Lavc61.19.101 alac |  |  |  |

### T67

| | |
| --- | --- |
| File | `T67 REMUX PCM 5.1 24bit.mkv` |
| Size | 59,775,928 bytes |
| SHA-256 | `4b6f2730ed9c32aa20de6189e0f79595e7e01aef5cd596101a8128caf7677d88` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 7,970 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac","audioChannels":6,"audioBitDepth":24,"audioCopy":false}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | pcm_s24le (PCM signed 24-bit little-endian) | 48,000 Hz, 6ch, s32, 24-bit, 6,912 kb/s, encoder Lavc61.19.101 pcm_s24le |  |  |  |

### T68

| | |
| --- | --- |
| File | `T68 REMUX Opus 5.1.mkv` |
| Size | 12,204,243 bytes |
| SHA-256 | `be196e5e4cb8b00e1246753f7c31a6299e5ac992959f7b97049bb7fe7b9897ce` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.000 s |
| Overall bitrate | 1,627 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac","audioChannels":6}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | opus (Opus (Opus Interactive Audio Codec)), opus | 48,000 Hz, 6ch 5.1, fltp, encoder Lavc61.19.101 libopus |  |  |  |

### T69

| | |
| --- | --- |
| File | `T69 REMUX Vorbis 5.1.mkv` |
| Size | 9,087,770 bytes |
| SHA-256 | `9a8791b6431bce460e9aeeb2fb668298896276b58dad320dce645ef7790a675a` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.003 s |
| Overall bitrate | 1,212 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac","audioChannels":6}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | vorbis (Vorbis), vorbis | 48,000 Hz, 6ch 5.1, fltp, encoder Lavc61.19.101 libvorbis |  |  |  |

### T80

| | |
| --- | --- |
| File | `T80 REMUX EAC3 7.1 real.mkv` |
| Size | 32,307,933 bytes |
| SHA-256 | `6f3102b2d49f9270990358285927aa0dc55af92c9854c01867bc927c0d6f3fdd` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 94.501 s |
| Overall bitrate | 2,735 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | third-party, https://samples.ffmpeg.org/A-codecs/AC3/eac3/7_pt_1.eac3 |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"eac3","audioChannels":8,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | eac3 (ATSC A/52B (AC-3, E-AC-3)), ec-3 | 48,000 Hz, 8ch 7.1, fltp, 1,662 kb/s |  |  |  |

### T81

| | |
| --- | --- |
| File | `T81 REMUX EAC3 5.1 real.mkv` |
| Size | 19,469,947 bytes |
| SHA-256 | `84fe12c1dc44e00e5a2e3602cb902202fd0983a1599b43fd130caf7bcd45cf60` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 91.328 s |
| Overall bitrate | 1,705 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | third-party, https://samples.ffmpeg.org/A-codecs/AC3/eac3/matrix2_english_5.1_640.eac3 |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"eac3","audioChannels":6,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | eac3 (ATSC A/52B (AC-3, E-AC-3)), ec-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s |  |  |  |

### T82

| | |
| --- | --- |
| File | `T82 REMUX AC3 5.1 real.mkv` |
| Size | 5,649,350 bytes |
| SHA-256 | `8110275ba611e45030efb21ebbe12342a6ef5e6cf687e803d648ceda2f87b1a8` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 30.016 s |
| Overall bitrate | 1,506 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | third-party, https://samples.ffmpeg.org/A-codecs/AC3/monsters_inc_5.1_448.ac3 |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"ac3","audioChannels":6,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 448 kb/s |  |  |  |

### T83

| | |
| --- | --- |
| File | `T83 REMUX EAC3 channelcheck.mkv` |
| Size | 14,524,611 bytes |
| SHA-256 | `179d1e9ffba1440ebb7a9b72572d45c7b1c73064b06968293bcf14ccb4205e7f` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 78.688 s |
| Overall bitrate | 1,477 kb/s |
| Streams | 2 |
| Container tags | COMPATIBLE_BRANDS=isommp42dby1; MAJOR_BRAND=dby1; MINOR_VERSION=0; ENCODER=Lavf61.7.100 |
| Origin | third-party, https://samples.ffmpeg.org/A-codecs/AC3/eac3/channelcheck-ddplus_480.mp4 |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"eac3","audioChannels":6,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), Main, level 30, avc1.4d401e | 720x480, SAR 853:720, DAR 853:480, yuv420p, 8-bit, 29.97 fps, progressive, range tv |  |  | default |
| 1 | audio | eac3 (ATSC A/52B (AC-3, E-AC-3)), ec-3 | 48,000 Hz, 6ch 5.1(side), fltp, 256 kb/s |  |  | default |

### T89

| | |
| --- | --- |
| File | `T89 REMUX EAC3 channelcheck resume.mkv` |
| Size | 14,524,611 bytes |
| SHA-256 | `179d1e9ffba1440ebb7a9b72572d45c7b1c73064b06968293bcf14ccb4205e7f` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 78.688 s |
| Overall bitrate | 1,477 kb/s |
| Streams | 2 |
| Container tags | COMPATIBLE_BRANDS=isommp42dby1; MAJOR_BRAND=dby1; MINOR_VERSION=0; ENCODER=Lavf61.7.100 |
| Origin | unverified |
| Expected lane | On-device remux, validate devtc |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), Main, level 30, avc1.4d401e | 720x480, SAR 853:720, DAR 853:480, yuv420p, 8-bit, 29.97 fps, progressive, range tv |  |  | default |
| 1 | audio | eac3 (ATSC A/52B (AC-3, E-AC-3)), ec-3 | 48,000 Hz, 6ch 5.1(side), fltp, 256 kb/s |  |  | default |

### T84

| | |
| --- | --- |
| File | `T84 REMUX EAC3 matroska.mkv` |
| Size | 6,271,777 bytes |
| SHA-256 | `a90a3bc0d5a2cc3bc71cf4217962d9f2f77c4d8146dd46552e3145355613a124` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 6.014 s |
| Overall bitrate | 8,343 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | third-party, https://samples.ffmpeg.org/A-codecs/AC3/eac3/sample-eac3.mkv |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","audio":"eac3","audioChannels":6,"audioCopy":true}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), Main, level 51, avc1.4d4033 | 1280x544, yuv420p, 8-bit, 23.976 fps, progressive, H.26[45] User Data Unregistered SEI message | eng |  | default |
| 1 | audio | eac3 (ATSC A/52B (AC-3, E-AC-3)), ec-3 | 48,000 Hz, 6ch 5.1(side), fltp, 1,536 kb/s |  |  | default |

### T85

| | |
| --- | --- |
| File | `T85 REMUX TrueHD real.mkv` |
| Size | 9,349,716 bytes |
| SHA-256 | `eb59be6ff2f6efc79ed020ba998c4e92b66cfd550f944fecec20486ac90a190d` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 5.923 s |
| Start time | 0.042 s |
| Overall bitrate | 12,628 kb/s |
| Streams | 19 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | third-party, https://samples.ffmpeg.org/A-codecs/TrueHD/vc1-with-truehd.m2ts |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"subtitles":13}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | vc1 (SMPTE VC-1), Advanced, level 3, tag WVC1 | 1920x1080, yuv420p, 23.976 fps, progressive, matrix bt709, transfer bt709, primaries bt709 |  |  |  |
| 1 | audio | truehd (TrueHD) | 48,000 Hz, 6ch 5.1(side), s32, 24-bit |  |  | default |
| 2 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s |  |  |  |
| 3 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s |  |  |  |
| 4 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s |  |  |  |
| 5 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s |  |  |  |
| 6 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  | default |
| 7 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 8 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 9 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 10 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 11 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 12 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 13 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 14 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 15 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 16 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 17 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 18 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |

### T86

| | |
| --- | --- |
| File | `T86 REMUX DTS-HD MA real.mkv` |
| Size | 9,862,811 bytes |
| SHA-256 | `cb81c1fe4ce5244befed71c881b83a0a2a279ee91c25a18f8ded42659f93e0f6` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 4.380 s |
| Overall bitrate | 18,014 kb/s |
| Streams | 12 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | third-party, https://samples.ffmpeg.org/A-codecs/DTS/bond_sample_dtshdma.m2ts |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"subtitles":4}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 41, avc1.640029 | 1920x1080, yuv420p, 8-bit, 23.976 fps, progressive, range tv, matrix bt709, transfer bt709, primaries bt709, H.26[45] User Data Unregistered SEI message |  |  |  |
| 1 | audio | dts (DCA (DTS Coherent Acoustics)), DTS-HD MA | 48,000 Hz, 6ch 5.1(side), s32p, 24-bit |  |  | default |
| 2 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 2ch stereo, fltp, 224 kb/s |  |  |  |
| 3 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 2ch stereo, fltp, 224 kb/s |  |  |  |
| 4 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 448 kb/s |  |  |  |
| 5 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 2ch stereo, fltp, 224 kb/s |  |  |  |
| 6 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 2ch stereo, fltp, 224 kb/s |  |  |  |
| 7 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 2ch stereo, fltp, 224 kb/s |  |  |  |
| 8 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  | default |
| 9 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 10 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |
| 11 | subtitle | hdmv_pgs_subtitle (HDMV Presentation Graphic Stream subtitles) |  |  |  |  |

### T87

| | |
| --- | --- |
| File | `T87 REMUX DTS 5.1 real.mkv` |
| Size | 27,317,157 bytes |
| SHA-256 | `664879b711e5bbeb2f9dfeece572b77402c5e8058f6e8e27226ed093aaf1ea48` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 119.999 s |
| Overall bitrate | 1,821 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | third-party, https://samples.ffmpeg.org/A-codecs/DTS/lotr_5.1_768.dts |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"flac","audioChannels":7,"tier":"copy"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | dts (DCA (DTS Coherent Acoustics)), DTS-ES | 48,000 Hz, 7ch 6.1, fltp, 768 kb/s |  |  |  |

### T88

| | |
| --- | --- |
| File | `T88 REMUX EAC3 JOC Atmos real.mkv` |
| Size | 22,509,298 bytes |
| SHA-256 | `0eaa0d11c24d958839abf220fae2cbdc32561be0fb00a2f8af15ca7184dcf2c1` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 98.432 s |
| Overall bitrate | 1,829 kb/s |
| Streams | 2 |
| Container tags | ENCODER=Lavf61.7.100 |
| Origin | third-party, https://devstreaming-cdn.apple.com/videos/streaming/examples/adv_dv_atmos/main.m3u8 |
| Expected lane | On-device remux, validate devtc |
| Harness expects | `{"video":"h264","audio":"eac3","audioProfile":"Dolby Digital Plus + Dolby Atmos","audioChannels":6,"audioCopy":true,"subtitles":0}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc61.19.101 libx264 |  |  |  |
| 1 | audio | eac3 (ATSC A/52B (AC-3, E-AC-3)), Dolby Digital Plus + Dolby Atmos, ec-3 | 48,000 Hz, 6ch 5.1(side), fltp, 768 kb/s |  |  | default |

### T70

| | |
| --- | --- |
| File | `T70 DIRECT audio FLAC 5.1 24bit.flac` |
| Size | 4,709,019 bytes |
| SHA-256 | `b63342feaf7f79e12aed5a746f6503b5f7a2a896542962207a850613b21998f3` |
| Container | flac (raw FLAC) |
| Duration | 59.989 s |
| Overall bitrate | 628 kb/s |
| Streams | 1 |
| Container tags | encoder=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | Direct play, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | flac (FLAC (Free Lossless Audio Codec)), flac | 48,000 Hz, 6ch 5.1, s32, 24-bit |  |  |  |

### T71

| | |
| --- | --- |
| File | `T71 DIRECT audio ALAC 5.1 24bit.m4a` |
| Size | 24,017,878 bytes |
| SHA-256 | `f8702c2ce73c53827b5f33c3e48d13cf3fe868561b49fb394290ac979fd27c0b` |
| Container | mov,mp4,m4a,3gp,3g2,mj2 (QuickTime / MOV) |
| Duration | 59.989 s |
| Overall bitrate | 3,203 kb/s |
| Streams | 1 |
| Container tags | major_brand=M4A ; minor_version=512; compatible_brands=M4A isomiso2; encoder=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | Direct play, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | alac (ALAC (Apple Lossless Audio Codec)), tag alac | 48,000 Hz, 6ch 5.1, s32p, 24-bit, 3,202 kb/s | und |  | default |

### T72

| | |
| --- | --- |
| File | `T72 DIRECT audio PCM 5.1 24bit.wav` |
| Size | 51,830,886 bytes |
| SHA-256 | `6a60495eae5db4c46a9b87ab192b0214ff902be53eb612b2af7bf3e3056bdd97` |
| Container | wav (WAV / WAVE (Waveform Audio)) |
| Duration | 59.989 s |
| Overall bitrate | 6,912 kb/s |
| Streams | 1 |
| Container tags | encoder=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | Direct play, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | pcm_s24le (PCM signed 24-bit little-endian), tag [1][0][0][0] | 48,000 Hz, 6ch 5.1, s32, 24-bit, 6,912 kb/s |  |  |  |

### T73

| | |
| --- | --- |
| File | `T73 DIRECT audio FLAC stereo 24bit.flac` |
| Size | 1,557,216 bytes |
| SHA-256 | `219c43e34a480da9032eea1ac6a18a54d5a9749343d87b65fdce71f6d6a32da7` |
| Container | flac (raw FLAC) |
| Duration | 60.000 s |
| Overall bitrate | 208 kb/s |
| Streams | 1 |
| Container tags | encoder=Lavf61.7.100 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | Direct play, validate none |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | audio | flac (FLAC (Free Lossless Audio Codec)), flac | 48,000 Hz, 2ch stereo, s32, 24-bit |  |  |  |

### T93

| | |
| --- | --- |
| File | `T93 DEVTC DivX3.avi` |
| Size | 10,597,966 bytes |
| SHA-256 | `952280ab0717de9b9a0236eb5141418d814dc61deeed06c185e1831ed90f5505` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 60.042 s |
| Overall bitrate | 1,412 kb/s |
| Streams | 2 |
| Container tags | software=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | msmpeg4v3 (MPEG-4 part 2 Microsoft variant version 3), tag DIV3 | 1280x720, yuv420p, 24 fps, progressive, 1,271 kb/s |  |  |  |
| 1 | audio | mp3 (MP3 (MPEG audio layer 3)), tag U[0][0][0], mp4a.40.34 | 48,000 Hz, 1ch mono, fltp, 128 kb/s |  |  |  |

### T94

| | |
| --- | --- |
| File | `T94 DEVTC DV NTSC 411.avi` |
| Size | 227,520,678 bytes |
| SHA-256 | `72cdaeee754ba3fbdfd8d6cefb8023f53643c4a421ba887f319f05e2fd50d3fe` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 60.027 s |
| Overall bitrate | 30,323 kb/s |
| Streams | 2 |
| Container tags | software=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | dvvideo (DV (Digital Video)), tag dvsd | 720x480, yuv411p, 29.97 fps, interlaced, bottom field first, 28,771 kb/s |  |  |  |
| 1 | audio | pcm_s16le (PCM signed 16-bit little-endian), tag [1][0][0][0] | 48,000 Hz, 2ch, s16, 16-bit, 1,536 kb/s |  |  |  |

### T95

| | |
| --- | --- |
| File | `T95 DEVTC Cinepak.avi` |
| Size | 21,779,402 bytes |
| SHA-256 | `cbcc08cd57d479e578ff6cfe4447c4f49e343681d77b7c32b75b35b82720477e` |
| Container | avi (AVI (Audio Video Interleaved)) |
| Duration | 60.000 s |
| Overall bitrate | 2,904 kb/s |
| Streams | 2 |
| Container tags | software=Lavf61.7.103 |
| Origin | generated, scripts/make-test-media.mjs, lavfi sine + testsrc2 only |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | cinepak (Cinepak), tag cvid | 320x240, rgb24, 24 fps, progressive, 1,479 kb/s |  |  |  |
| 1 | audio | pcm_s16le (PCM signed 16-bit little-endian), tag [1][0][0][0] | 44,100 Hz, 2ch, s16, 16-bit, 1,411 kb/s |  |  |  |

### T96

| | |
| --- | --- |
| File | `T96 DEVTC Theora real.mkv` |
| Size | 710,098 bytes |
| SHA-256 | `e0fabe357bfad0714425cd9e95ffbf7cddea3948a05251839505f150d2685f78` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 10.480 s |
| Overall bitrate | 542 kb/s |
| Streams | 1 |
| Container tags | ENCODER=Lavf61.7.103 |
| Origin | third-party, https://samples.ffmpeg.org/ogg/Theora/susie-exp.ogg |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | theora (Theora) | 688x470, yuv420p, 25 fps, progressive |  |  |  |

### T99

| | |
| --- | --- |
| File | `T99 REMUX H264 ASS real.mkv` |
| Size | 48,135 bytes |
| SHA-256 | `770c2de458ef14dde909e143581e5804accb1cd6d5f139295fc43e92a5bbf0ea` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 10.009 s |
| Overall bitrate | 38 kb/s |
| Streams | 3 |
| Container tags | ENCODER=Lavf62.12.102 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","subtitles":1}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), Main, level 51, avc1.4d4033 | 720x480, yuv420p, 8-bit, 23.976 fps, progressive, H.26[45] User Data Unregistered SEI message |  | Pure white | default |
| 1 | subtitle | ass (ASS (Advanced SSA) subtitle) |  | eng |  | default |
| 2 | attachment | ttf (TrueType font) | ETHNOCEN.TTF, application/x-truetype-font |  |  |  |

### T100

| | |
| --- | --- |
| File | `T100 REMUX H264 SSA real.mkv` |
| Size | 1,589,478 bytes |
| SHA-256 | `186ab97cbb5d1c0782fd1c3f79a393013158735497587ed2eaf3e32970c79466` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 60.600 s |
| Overall bitrate | 210 kb/s |
| Streams | 4 |
| Container tags | ENCODER=Lavf62.12.102 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","audio":"aac","subtitles":2}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 31, avc1.64001f | 1280x720, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc62.28.102 libx264 |  |  |  |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, mp4a.40.2 | 48,000 Hz, 1ch mono, fltp, encoder Lavc62.28.102 aac | eng |  |  |
| 2 | subtitle | ass (ASS (Advanced SSA) subtitle) |  | eng |  | default |
| 3 | subtitle | ass (ASS (Advanced SSA) subtitle) |  | spa |  |  |

### T101

| | |
| --- | --- |
| File | `T101 REMUX H264 AC3 12min slipstream.mkv` |
| Size | 563,094,346 bytes |
| SHA-256 | `d9f7e8a34851ed7c06afe0a3ae820762cb820946b8328e05642932bcb2b2cadb` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 720.000 s |
| Overall bitrate | 6,257 kb/s |
| Streams | 5 |
| Container tags | ENCODER=Lavf62.12.102 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","audio":"ac3","subtitles":3}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 40, avc1.640028 | 1920x1080, yuv420p, 8-bit, 24 fps, progressive, range tv, matrix bt709, transfer bt709, primaries bt709, H.26[45] User Data Unregistered SEI message, encoder Lavc62.28.102 libx264 | eng |  | default |
| 1 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s, encoder Lavc62.28.102 ac3 | eng |  |  |
| 2 | subtitle | subrip (SubRip subtitle) | encoder Lavc62.28.102 srt | eng |  | default |
| 3 | subtitle | subrip (SubRip subtitle) | encoder Lavc62.28.102 srt | spa |  |  |
| 4 | subtitle | subrip (SubRip subtitle) | encoder Lavc62.28.102 srt | fra |  |  |

### T102

| | |
| --- | --- |
| File | `T102 REMUX H264 AC3 AAC 12min slipstream.mkv` |
| Size | 580,599,925 bytes |
| SHA-256 | `c0cc8673ea9ca8e894f6202e7f4f6f2d63e2856bb9bc998123a8adf245051844` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 720.021 s |
| Overall bitrate | 6,451 kb/s |
| Streams | 6 |
| Container tags | ENCODER=Lavf62.12.102 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","audio":"ac3","audioRenditions":2,"subtitles":3}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 40, avc1.640028 | 1920x1080, yuv420p, 8-bit, 24 fps, progressive, range tv, matrix bt709, transfer bt709, primaries bt709, H.26[45] User Data Unregistered SEI message, encoder Lavc62.28.102 libx264 | eng |  | default |
| 1 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s, encoder Lavc62.28.102 ac3 | eng |  | default |
| 2 | audio | aac (AAC (Advanced Audio Coding)), LC, mp4a.40.2 | 48,000 Hz, 2ch stereo, fltp, encoder Lavc62.28.102 aac | spa |  |  |
| 3 | subtitle | subrip (SubRip subtitle) | encoder Lavc62.28.102 srt | eng |  | default |
| 4 | subtitle | subrip (SubRip subtitle) | encoder Lavc62.28.102 srt | spa |  |  |
| 5 | subtitle | subrip (SubRip subtitle) | encoder Lavc62.28.102 srt | fra |  |  |

### T103

| | |
| --- | --- |
| File | `T103 REMUX H264 AAC chapters.mkv` |
| Size | 153,726,198 bytes |
| SHA-256 | `2c51a658ab3cd5aa8750614be3c8701d62106e60f7ff6bdf923c8870801ac442` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 180.021 s |
| Overall bitrate | 6,831 kb/s |
| Streams | 2 |
| Chapters | 6: 0.0s Chapter 1; 30.0s Chapter 2; 60.0s Chapter 3; 90.0s Chapter 4; 120.0s Chapter 5; 150.0s Chapter 6 |
| Container tags | ENCODER=Lavf62.12.102 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","audio":"aac"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 40, avc1.640028 | 1920x1080, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc62.28.102 libx264 |  |  |  |
| 1 | audio | aac (AAC (Advanced Audio Coding)), LC, mp4a.40.2 | 48,000 Hz, 1ch mono, fltp, encoder Lavc62.28.102 aac | eng |  |  |

### T104

| | |
| --- | --- |
| File | `T104 REMUX H264 multi-audio sidecar.mkv` |
| Size | 77,368,230 bytes |
| SHA-256 | `316c58b6fef5c4268cfb68af255de2275c0346b7dec7dcab9b0337418ccd6b08` |
| Container | matroska,webm (Matroska / WebM) |
| Duration | 120.000 s |
| Overall bitrate | 5,158 kb/s |
| Streams | 5 |
| Container tags | title=T104 REMUX H264 multi-audio sidecar; ENCODER=Lavf62.12.102 |
| Origin | unverified |
| Expected lane | On-device remux, validate none |
| Harness expects | `{"video":"h264","audio":"ac3","audioRenditions":2,"audioCopy":true,"subtitles":3,"tier":"copy"}` |

| # | Type | Codec | Detail | Language | Title | Flags |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | video | h264 (H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10), High, level 41, avc1.640029 | 1920x1080, yuv420p, 8-bit, 24 fps, progressive, range tv, H.26[45] User Data Unregistered SEI message, encoder Lavc62.28.102 libx264 |  |  |  |
| 1 | audio | ac3 (ATSC A/52A (AC-3)), ac-3 | 48,000 Hz, 6ch 5.1(side), fltp, 640 kb/s, encoder Lavc62.28.102 ac3 | rus | Russian AC3 5.1 | default |
| 2 | audio | dts (DCA (DTS Coherent Acoustics)), DTS | 48,000 Hz, 6ch 5.1(side), fltp, 1,536 kb/s, encoder Lavc62.28.102 dca | dan | Danish DTS 5.1 |  |
| 3 | subtitle | subrip (SubRip subtitle) | encoder Lavc62.28.102 subrip | rus |  |  |
| 4 | subtitle | subrip (SubRip subtitle) | encoder Lavc62.28.102 subrip | eng |  |  |
| sidecar | subtitle | subrip | `T104 REMUX H264 multi-audio sidecar.da.srt`, 1,521 bytes, SHA-256 `89145b871b4125505a6c692ec1d8aa71e5ae51f720b5df64690cb4f6933e48d2` | | | |

### L01

Live TV channel **Bloomberg TV+ 4K HEVC (partner)**, origin `https://d8975dc3.wurl.com/master/f36d25e7e52f1ba8d7e56eb859c636563214f541/U2Ftc3VuZy1nYl9CbG9vbWJlcmdUVlBsdXNfSExT/playlist.m3u8` in [`test/playback/live/real.m3u`](../test/playback/live/real.m3u). Not a file: its streams are whatever the origin sends at run time, so nothing here is probed.

Expected lane: On-device remux, validate live, harness expects {"audioTracks":1}.

### L02

Live TV channel **Africanews English**, origin `https://cdn-euronews.akamaized.net/live/eds/africanews-en/25049/index.m3u8` in [`test/playback/live/real.m3u`](../test/playback/live/real.m3u). Not a file: its streams are whatever the origin sends at run time, so nothing here is probed.

Expected lane: On-device remux, validate live, harness expects {"audioTracks":1}.

### L03

Live TV channel **Unified live**, origin `https://demo.unified-streaming.com/k8s/live/stable/live.isml/.m3u8` in [`test/playback/live/real.m3u`](../test/playback/live/real.m3u). Not a file: its streams are whatever the origin sends at run time, so nothing here is probed.

Expected lane: On-device remux, validate live, harness expects {"audioTracks":1}.

### L04

Live TV channel **Unified SCTE-35 live**, origin `https://demo.unified-streaming.com/k8s/live/stable/scte35.isml/.m3u8` in [`test/playback/live/real.m3u`](../test/playback/live/real.m3u). Not a file: its streams are whatever the origin sends at run time, so nothing here is probed.

Expected lane: On-device remux, validate live, harness expects {"audioTracks":1}.

### L05

Live TV channel **DW English**, origin `https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/master.m3u8` in [`test/playback/live/real.m3u`](../test/playback/live/real.m3u). Not a file: its streams are whatever the origin sends at run time, so nothing here is probed.

Expected lane: On-device remux, validate live, harness expects {"audioTracks":1}.
