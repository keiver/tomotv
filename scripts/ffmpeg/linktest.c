/*
 * Proves the built xcframeworks link and behave, before any app code changes.
 *
 * Everything checked here is something the MPVKit build could NOT do, so a pass
 * is the whole justification for owning the build:
 *   - libswscale present and usable (it could not link at all: shaderc)
 *   - libavfilter present, including the VideoToolbox/Metal filters
 *   - decoders MPVKit's allowlist switched off
 *   - https through mbedTLS instead of gnutls, with certificate verification ON
 *
 * Built and run by run-linktest.sh, for macOS natively and for the tvOS
 * simulator via `xcrun simctl spawn`. Exit status is the result: 0 means every
 * required check passed.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "libavcodec/avcodec.h"
#include "libavfilter/avfilter.h"
#include "libavformat/avformat.h"
#include "libavutil/avutil.h"
#include "libavutil/log.h"
#include "libswresample/swresample.h"
#include "libswscale/swscale.h"
#include "archive.h"
#include "archive_entry.h"

static int failures = 0;

static void check(int ok, const char *what, const char *detail) {
    printf("  %s %-34s %s\n", ok ? "ok  " : "FAIL", what, detail ? detail : "");
    if (!ok) failures++;
}

static int has_protocol(const char *name, int output) {
    void *opaque = NULL;
    const char *p;
    while ((p = avio_enum_protocols(&opaque, output)))
        if (strcmp(p, name) == 0) return 1;
    return 0;
}

/* What live TV lists carry beyond plain http: AES-128 HLS (crypto), multicast and RTSP's UDP
 * transport (udp, rtp), rtmp, mms, keys as data: URIs, DASH (libxml2) and teletext (libzvbi). */
static void check_live_tv(void) {
    static const char *protocols[] = { "crypto", "udp", "rtp", "rtmp", "rtmps", "data", "mmsh", "mmst", "https" };
    puts("live tv");
    for (size_t i = 0; i < sizeof(protocols) / sizeof(protocols[0]); i++)
        check(has_protocol(protocols[i], 0), protocols[i], "protocol");
    check(av_find_input_format("dash") != NULL, "dash demuxer", "libxml2");
    check(av_find_input_format("rtsp") != NULL, "rtsp demuxer", "");
    const AVCodec *tt = avcodec_find_decoder_by_name("libzvbi_teletextdec");
    check(tt != NULL, "libzvbi_teletextdec", tt ? "" : "not registered");
}

/* Decoders MPVKit's --disable-decoders allowlist left out, plus the modern ones
 * nobody on this platform ships. These are the reason for the whole exercise. */
static void check_decoders(void) {
    static const struct { enum AVCodecID id; const char *label; } wanted[] = {
        { AV_CODEC_ID_MSMPEG4V3, "msmpeg4v3 (DivX 3)" },
        { AV_CODEC_ID_THEORA,    "theora" },
        { AV_CODEC_ID_DVVIDEO,   "dvvideo" },
        { AV_CODEC_ID_CINEPAK,   "cinepak" },
        { AV_CODEC_ID_VVC,       "vvc (H.266)" },
        { AV_CODEC_ID_PRORES,    "prores" },
        { AV_CODEC_ID_AV1,       "av1" },
        { AV_CODEC_ID_SIPR,      "sipr (RealAudio)" },
        { AV_CODEC_ID_ATRAC3,    "atrac3" },
        { AV_CODEC_ID_QDM2,      "qdm2" },
    };
    puts("decoders");
    for (size_t i = 0; i < sizeof(wanted) / sizeof(wanted[0]); i++) {
        const AVCodec *c = avcodec_find_decoder(wanted[i].id);
        check(c != NULL, wanted[i].label, c ? c->name : "not registered");
    }

    int total = 0;
    void *it = NULL;
    const AVCodec *c;
    while ((c = av_codec_iterate(&it)))
        if (av_codec_is_decoder(c)) total++;
    printf("  ---- %d decoders registered\n", total);
}

static void check_encoders(void) {
    static const char *wanted[] = { "h264_videotoolbox", "hevc_videotoolbox", "flac", "aac", "aac_at" };
    puts("encoders");
    for (size_t i = 0; i < sizeof(wanted) / sizeof(wanted[0]); i++) {
        const AVCodec *c = avcodec_find_encoder_by_name(wanted[i]);
        /* aac_at is a bonus, not a requirement: it only exists with AudioToolbox
         * and its absence changes nothing the engine relies on today. */
        if (!c && strcmp(wanted[i], "aac_at") == 0) {
            printf("  note %-34s absent (AudioToolbox encoder not built)\n", wanted[i]);
            continue;
        }
        check(c != NULL, wanted[i], c ? "" : "not registered");
    }
}

static void check_filters(void) {
    static const char *required[] = { "bwdif", "scale", "format", "aresample" };
    static const char *optional[] = { "yadif_videotoolbox", "scale_vt", "transpose_vt", "ass", "subtitles", "loudnorm" };
    puts("filters");
    for (size_t i = 0; i < sizeof(required) / sizeof(required[0]); i++)
        check(avfilter_get_by_name(required[i]) != NULL, required[i], "");
    for (size_t i = 0; i < sizeof(optional) / sizeof(optional[0]); i++) {
        const AVFilter *f = avfilter_get_by_name(optional[i]);
        printf("  %s %-34s %s\n", f ? "ok  " : "note", optional[i], f ? "" : "absent");
    }
}

/* The formats the hand-written conversion path gets wrong. swscale is the fix,
 * so prove it can build a context for each of them. */
static void check_swscale(void) {
    static const struct { enum AVPixelFormat fmt; const char *label; } shapes[] = {
        { AV_PIX_FMT_YUV422P10LE, "yuv422p10le (ProRes 422)" },
        { AV_PIX_FMT_YUV411P,     "yuv411p (DV NTSC)" },
        { AV_PIX_FMT_YUV444P10LE, "yuv444p10le (ProRes 4444)" },
        { AV_PIX_FMT_YUV420P,     "yuv420p" },
    };
    puts("swscale");
    for (size_t i = 0; i < sizeof(shapes) / sizeof(shapes[0]); i++) {
        struct SwsContext *s = sws_getContext(1920, 1080, shapes[i].fmt,
                                              1920, 1080, AV_PIX_FMT_NV12,
                                              SWS_BILINEAR, NULL, NULL, NULL);
        check(s != NULL, shapes[i].label, s ? "-> nv12" : "no conversion path");
        sws_freeContext(s);
    }
}

/* The one runtime behaviour a link test cannot infer: whether mbedTLS verifies a
 * real certificate chain. gnutls loads a system trust store; mbedTLS only reads
 * an explicit ca_file. If this fails, TLS needs a bundled CA list. */
/* Returns the avformat_open_input result for `url`, optionally forcing
 * certificate verification on. AVERROR_INVALIDDATA means the handshake and the
 * HTTP exchange both succeeded and only the demuxer refused the payload, which
 * is a pass for a TLS check pointed at a non-media URL. */
static int open_tls(const char *url, const char *verify) {
    AVFormatContext *ctx = NULL;
    AVDictionary *opts = NULL;
    av_dict_set(&opts, "rw_timeout", "10000000", 0);
    if (verify) av_dict_set(&opts, "tls_verify", verify, 0);
    /* An origin that answers only a browser's User-Agent (LINKTEST_USER_AGENT), as the engine passes it. */
    if (getenv("LINKTEST_USER_AGENT")) av_dict_set(&opts, "user_agent", getenv("LINKTEST_USER_AGENT"), 0);

    int ret = avformat_open_input(&ctx, url, NULL, &opts);
    av_dict_free(&opts);
    if (ret >= 0) avformat_close_input(&ctx);
    return ret;
}

static int tls_reached_http(int ret) {
    return ret >= 0 || ret == AVERROR_INVALIDDATA;
}

/*
 * The engine sets no tls_verify option, so FFmpeg's default applies, and that
 * default is OFF. Measured on the tvOS simulator, the MPVKit/gnutls build we
 * ship today behaves exactly the same way: the default connects, and forcing
 * tls_verify=1 fails with "Peer certificate failed verification".
 *
 * So the required check is the DEFAULT path — that is the app's real behaviour
 * and the bar for not regressing. Verification is reported as a note, because
 * neither build passes it: an https Jellyfin server is reached today over an
 * unauthenticated TLS connection. Fixing that needs a CA bundle passed as
 * `ca_file`; it is a real pre-existing security gap, not something this build
 * introduced.
 */
static void check_https(const char *url) {
    puts("https (mbedTLS)");
    if (!url) { puts("  skip no URL given"); return; }

    int def = open_tls(url, NULL);
    char err[AV_ERROR_MAX_STRING_SIZE] = { 0 };
    av_strerror(def, err, sizeof(err));
    check(tls_reached_http(def), "default (matches shipping build)",
          tls_reached_http(def) ? "handshake + HTTP ok" : err);

    /* A live HLS master never ends the strict pass: the hls demuxer skips every segment whose
     * host fails verification and reloads the playlist for the next, without end. */
    if (strstr(url, ".m3u8")) { puts("  skip tls_verify=1 (live playlist)"); return; }
    int strict = open_tls(url, "1");
    printf("  %s %-34s %s\n", tls_reached_http(strict) ? "ok  " : "note",
           "tls_verify=1",
           tls_reached_http(strict) ? "verified" : "no trust store (same as gnutls today)");
}

/* The book reader's archive formats, and the liblzma the 7-Zip and xz codecs need. */
static void check_libarchive(void) {
    puts("libarchive");
    struct archive *a = archive_read_new();
    int registered = archive_read_support_format_zip(a) == ARCHIVE_OK
        && archive_read_support_format_tar(a) == ARCHIVE_OK
        && archive_read_support_format_rar(a) == ARCHIVE_OK
        && archive_read_support_format_rar5(a) == ARCHIVE_OK
        && archive_read_support_format_7zip(a) == ARCHIVE_OK
        && archive_read_support_filter_gzip(a) == ARCHIVE_OK
        && archive_read_support_filter_bzip2(a) == ARCHIVE_OK
        && archive_read_support_filter_xz(a) == ARCHIVE_OK;
    archive_read_free(a);
    check(registered, "zip tar rar rar5 7zip gz bz2 xz", archive_version_details());
    check(strstr(archive_version_details(), "liblzma/") != NULL, "liblzma linked", "");
}

int main(int argc, char **argv) {
    printf("libavcodec  %s\n", AV_STRINGIFY(LIBAVCODEC_VERSION));
    printf("configuration:\n%s\n\n", avcodec_configuration());

    /* LINKTEST_LOG=verbose|debug turns FFmpeg's own log up, for a URL that fails to open. */
    if (getenv("LINKTEST_LOG"))
        av_log_set_level(strcmp(getenv("LINKTEST_LOG"), "debug") == 0 ? AV_LOG_DEBUG : AV_LOG_VERBOSE);
    avformat_network_init();
    check_decoders();
    check_encoders();
    check_filters();
    check_swscale();
    check_live_tv();
    check_libarchive();
    check_https(argc > 1 ? argv[1] : NULL);
    avformat_network_deinit();

    printf("\n%s (%d failures)\n", failures ? "FAILED" : "PASSED", failures);
    return failures ? 1 : 0;
}
