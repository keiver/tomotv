# Playback coverage

Every result cell below is what the shipping app reported when the harness played that file on a simulator, or the reason it did not run; none of it comes from a support table. 71 fixtures, generated 2026-09-01 by `npm run report:playback`.

The failures are in the table. A coverage page that lists only passes is worth nothing to someone whose file is one of the failures.

## Results

- **tvOS**: 59/67 passed, on Apple TV 4K (3rd generation)

| ID | Container | Video | Audio | Expected lane | tvOS |
| --- | --- | --- | --- | --- | --- |
| T01 | mp4 | h264 1280x720 | aac 2ch | Direct play | pass |
| T05 | mkv | h264 1920x800 | dts 6ch | On-device remux | fail: baseline hash |
| T06 | mkv | h264 1920x1080 | truehd 6ch | On-device remux | pass |
| T07 | mkv | h264 1280x544 | ac3 6ch | On-device remux | fail: baseline hash |
| T08 | mkv | h264 1280x544 | ac3 6ch | On-device remux | fail: baseline hash |
| T09 | mkv | h264 1024x576 | aac 2ch | On-device remux | fail: baseline hash |
| T10 | mkv | hevc 10-bit 1920x804 | aac 2ch | On-device remux | skipped |
| T11 | mkv | h264 1280x544 | aac 2ch | On-device remux | fail: baseline hash |
| T20 | webm | vp8 1920x1080 | vorbis 2ch | On-device remux | fail: too slow, 4.3s of 8s |
| T21 | webm | vp9 2048x858 | opus 2ch | On-device remux | fail: too slow, 4.5s of 8s |
| T22 | avi | mpeg4 1920x804 | mp3 2ch | On-device remux | pass |
| T23 | mpg | mpeg2video 1920x804 | mp2 2ch | On-device remux | pass |
| T24 | ts | mpeg2video 1920x804 | mp2 2ch | On-device remux | pass |
| T25 | wmv | wmv2 1920x804 | wmav2 2ch | On-device remux | pass |
| T26 | wmv | wmv3 640x480 | wmav2 2ch | On-device remux | pass |
| T27 | wmv | vc1 1440x576 | none | On-device remux | pass |
| T28 | flv | flv1 1920x804 | mp3 2ch | On-device remux | pass |
| T29 | 3gp | h263 704x576 | aac 2ch | On-device remux | pass |
| T30 | rm | rv40 640x480 | cook 2ch | On-device remux | pass |
| T31 | avi | vp6 320x240 | mp3 2ch | On-device remux | pass |
| T32 | mov | prores 10-bit 1280x720 | aac 1ch | On-device remux | skipped |
| T33 | avi | mjpeg 1280x720 | pcm_s16le 1ch | On-device remux | pass |
| T34 | mkv | ffv1 1280x720 | flac 1ch | On-device remux | pass |
| T35 | avi | huffyuv 1280x720 | pcm_s16le 1ch | On-device remux | pass |
| T36 | webm | vp9 10-bit 1280x720 | opus 1ch | On-device remux | skipped |
| T37 | mpg | mpeg2video 1280x720 | mp2 1ch | On-device remux | pass |
| T38 | avi | mpeg4 1280x720 | adpcm_ima_wav 2ch | On-device remux | pass |
| T39 | mkv | h264 1280x720 | ac3 1ch | On-device remux | pass |
| T90 | ts | mpeg2video 1280x720 | mp2 1ch | On-device remux | pass |
| T92 | mp4 | av1 1280x720 | aac 1ch | On-device remux | pass |
| T40 | webm | vp9 7680x4320 | opus 2ch | Server transcode | fail: too slow, 0.0s of 8s |
| T41 | webm | vp9 10-bit 1920x804 | opus 2ch | On-device remux | skipped |
| T42 | avi | msmpeg4v3 1920x804 | mp3 2ch | On-device remux | pass |
| T43 | mkv | h264 720x480 | none | On-device remux | pass |
| T44 | mkv | theora 2560x1440 | aac 1ch | Server transcode | pass |
| T45 | mkv | msmpeg4v3 2560x1920 | eac3 6ch | Server transcode | pass |
| T50 | wav | audio only | pcm_s16le 2ch | Direct play | pass |
| T51 | mp3 | audio only | mp3 2ch | Direct play | pass |
| T52 | mp3 | audio only | mp3 2ch | Direct play | pass |
| T53 | mp3 | audio only | mp3 2ch | Direct play | pass |
| T54 | ogg | audio only | vorbis 2ch | On-device remux | pass |
| T55 | oga | audio only | vorbis 2ch | On-device remux | pass |
| T56 | wma | audio only | wmav2 2ch | On-device remux | pass |
| T60 | mkv | h264 1280x720 | ac3 6ch | On-device remux | pass |
| T61 | mkv | h264 1280x720 | eac3 6ch | On-device remux | pass |
| T62 | mkv | h264 1280x720 | flac 8ch | On-device remux | pass |
| T63 | mkv | h264 1280x720 | truehd 6ch | On-device remux | pass |
| T64 | mkv | h264 1280x720 | dts 6ch | On-device remux | pass |
| T65 | mkv | h264 1280x720 | flac 6ch | On-device remux | pass |
| T66 | mkv | h264 1280x720 | alac 6ch | On-device remux | pass |
| T67 | mkv | h264 1280x720 | pcm_s24le 6ch | On-device remux | pass |
| T68 | mkv | h264 1280x720 | opus 6ch | On-device remux | pass |
| T69 | mkv | h264 1280x720 | vorbis 6ch | On-device remux | pass |
| T80 | mkv | h264 1280x720 | eac3 8ch | On-device remux | pass |
| T81 | mkv | h264 1280x720 | eac3 6ch | On-device remux | pass |
| T82 | mkv | h264 1280x720 | ac3 6ch | On-device remux | pass |
| T83 | mkv | h264 720x480 | eac3 6ch | On-device remux | pass |
| T89 | mkv | h264 720x480 | eac3 6ch | On-device remux | pass |
| T84 | mkv | h264 1280x544 | eac3 6ch | On-device remux | pass |
| T85 | mkv | vc1 1920x1080 | truehd 6ch | On-device remux | pass |
| T86 | mkv | h264 1920x1080 | dts 6ch | On-device remux | pass |
| T87 | mkv | h264 1280x720 | dts 7ch | On-device remux | pass |
| T88 | mkv | h264 1280x720 | eac3 6ch | On-device remux | pass |
| T70 | flac | audio only | flac 6ch | Direct play | pass |
| T71 | m4a | audio only | alac 6ch | Direct play | pass |
| T72 | wav | audio only | pcm_s24le 6ch | Direct play | pass |
| T73 | flac | audio only | flac 2ch | Direct play | pass |
| T93 | avi | msmpeg4v3 1280x720 | mp3 1ch | On-device remux | pass |
| T94 | avi | dvvideo 720x480 | pcm_s16le 2ch | On-device remux | pass |
| T95 | avi | cinepak 320x240 | pcm_s16le 2ch | On-device remux | pass |
| T96 | mkv | theora 688x470 | none | On-device remux | pass |

## What this does not prove

**No automated run here exercises 10-bit video.** 4 fixtures carry a video stream deeper than 8 bits and 4 of them are skipped on simulators, each for the reason recorded against it:

| ID | Video | Why it is skipped |
| --- | --- | --- |
| T10 | hevc Main 10, yuv420p10le | tvOS SIMULATOR rejects the PQ master (NSURLError -1002) and the server HDR transcode too; the PQ path was built against real-device behavior (-12927). Run with --only T10 on a device build to verify. |
| T32 | prores HQ, yuv422p10le | 10-bit plan opens hevc_videotoolbox and the tvOS SIMULATOR has no HEVC encode; same class as T10. Verified playing on device 2026-08-17. Run with --only T32 on a device build. |
| T36 | vp9 Profile 2, yuv420p10le | 10-bit plan opens hevc_videotoolbox and the tvOS SIMULATOR has no HEVC encode; same class as T10. Verified playing on device 2026-08-17. Run with --only T36 on a device build. |
| T41 | vp9 Profile 2, yuv420p10le | 10-bit plan opens hevc_videotoolbox and the SIMULATOR has no HEVC encode; same class as T32/T36. Run with --only T41 on a device build. |

Two of those notes record a manual device check rather than a harness result. That is a weaker claim than a green row above, and it is written that way deliberately. `--only <id>` forces any skipped fixture to run on a device build.

Results come from simulators. A simulator shares the Mac's decoders and network stack, so it is the right place to prove which lane the engine picks and the wrong place to prove hardware decode.

## The corpus

71 fixtures, 3.8 GB, none of it in git. Origin is recorded per file in [`test/playback/provenance.json`](../test/playback/provenance.json), from the generator's own tables and the files' embedded tags:

| Origin | Count | Redistributable |
| --- | --- | --- |
| `generated` | 27 | yes, ours outright |
| `unverified` | 24 | no |
| `third-party` | 10 | no, linked by URL and checksum only |
| `blender-open-movie` | 9 | attribution required, license version unverified |
| `matroska-test-suite` | 1 | license unverified |

Only the `generated` set is ours to hand out, and it does not need hosting: `npm run make:test-media` rebuilds those from `lavfi` sine tones and `testsrc2` video, deterministically, from nothing. The third-party files are recorded as URL plus SHA-256 in [`media-sources.json`](../test/playback/media-sources.json) and are fetched, never rehosted.

## Reproducing this

```bash
npm run make:test-media          # rebuild the generated fixtures, fetch the linked ones
npm run test:playback:preflight  # eight prerequisites, all server checks authenticated
npm run test:playback -- --udid <UDID> --json run.json
npm run report:playback -- --run tvOS=run.json
```

Setup, the fixture roots, and what a misconfigured Jellyfin does to a run are in [`test/playback/CLAUDE.md`](../test/playback/CLAUDE.md).
