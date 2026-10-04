# Third-party notices

The Swift sources in this package are MIT licensed (see LICENSE).

`scripts/fetch-ffmpeg.js` downloads prebuilt static xcframeworks that the TomoFFmpeg pod
links into the app. They are built, unmodified, by `scripts/ffmpeg/build.sh` in the
[tomotv repository](https://github.com/keiver/tomotv) from the versions pinned in
`scripts/ffmpeg/sources.sh` there, and published with their checksums as GitHub releases
of that repository. The release tag and each artifact's SHA256 are in `ffmpeg-lock.json`.

| Library                                                                             | License         |
| ----------------------------------------------------------------------------------- | --------------- |
| FFmpeg (libavcodec, libavformat, libavutil, libswresample, libswscale, libavfilter) | LGPL-3.0        |
| Mbed TLS                                                                            | Apache-2.0      |
| dav1d                                                                               | BSD-2-Clause    |
| uavs3d                                                                              | BSD-3-Clause    |
| libass                                                                              | ISC             |
| FreeType                                                                            | FTL             |
| HarfBuzz                                                                            | MIT (old style) |
| GNU FriBidi                                                                         | LGPL-2.1        |
| libarchive                                                                          | BSD-2-Clause    |
| XZ Utils (liblzma)                                                                  | 0BSD            |
| libzvbi                                                                             | LGPL-2.1        |

The LGPL libraries are linked as static archives. An app that ships them must present
these notices and the license texts, and must offer the object files needed to relink the
app against a modified version of each LGPL library on request. The license texts and
complete corresponding source for every library are available from the links in
`constants/licenses.ts` of the tomotv repository.
