// Capability probe for the linked FFmpeg build. Built and run by
// scripts/probe-codecs.mjs (`npm run probe:codecs`).
//
// Answers, against the exact FFmpeg the app links, questions that symbol
// inspection cannot: which encoders are REGISTERED (the static archives carry
// object files for codecs the build never enabled), what channel layouts and
// sample formats each accepts, and whether the mp4 muxer will write a header
// for a given codec in the fragment configuration Remuxer.swift uses.
//
// Run this after any FFmpeg bump. The 2026-08-11 run is what established that
// `aac_at` is not in the build at all, so AudioTranscoder's preference for it
// has never once executed.

#include <stdio.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/channel_layout.h>

static const char *sfmt_name(enum AVSampleFormat f) {
  const char *n = av_get_sample_fmt_name(f);
  return n ? n : "?";
}

static void describe(const AVCodec *c) {
  printf("  %-10s ", c->name);

  const enum AVSampleFormat *fmts = NULL;
  int nf = 0;
  printf("sample_fmts=[");
  if (avcodec_get_supported_config(NULL, c, AV_CODEC_CONFIG_SAMPLE_FORMAT, 0, (const void **)&fmts, &nf) >= 0 && fmts) {
    for (int i = 0; i < nf; i++) printf("%s%s", i ? "," : "", sfmt_name(fmts[i]));
  } else {
    printf("unrestricted");
  }
  printf("] ch_layouts=[");

  const AVChannelLayout *lays = NULL;
  int nl = 0;
  if (avcodec_get_supported_config(NULL, c, AV_CODEC_CONFIG_CHANNEL_LAYOUT, 0, (const void **)&lays, &nl) >= 0 && lays) {
    for (int i = 0; i < nl; i++) {
      char buf[128];
      av_channel_layout_describe(&lays[i], buf, sizeof buf);
      printf("%s%s", i ? "," : "", buf);
    }
  } else {
    printf("unrestricted");
  }
  printf("]\n");
}

// Opens `c` the way AudioTranscoder.swift does: av_channel_layout_default() for
// the layout, sample_fmts[0] for the format. Both of those are the habits the
// audio work replaces, so this prints what they actually produce.
static void try_open(const AVCodec *c, int channels) {
  if (!c) return;
  AVCodecContext *ctx = avcodec_alloc_context3(c);
  if (!ctx) return;

  av_channel_layout_default(&ctx->ch_layout, channels);
  char lay[128];
  av_channel_layout_describe(&ctx->ch_layout, lay, sizeof lay);

  const enum AVSampleFormat *fmts = NULL;
  int nf = 0;
  avcodec_get_supported_config(NULL, c, AV_CODEC_CONFIG_SAMPLE_FORMAT, 0, (const void **)&fmts, &nf);
  ctx->sample_fmt = (fmts && nf) ? fmts[0] : AV_SAMPLE_FMT_FLTP;
  ctx->sample_rate = 48000;
  ctx->bit_rate = 192000;
  ctx->time_base = (AVRational){1, 48000};
  ctx->flags |= AV_CODEC_FLAG_GLOBAL_HEADER;

  int ret = avcodec_open2(ctx, c, NULL);
  char err[128];
  av_strerror(ret, err, sizeof err);
  printf("  %-10s %dch default=%-14s sample_fmt=%-6s -> %s%s\n", c->name, channels, lay, sfmt_name(ctx->sample_fmt), ret >= 0 ? "OPEN OK" : "FAILED: ", ret >= 0 ? "" : err);
  avcodec_free_context(&ctx);
}

// Remuxer.swift writes the init segment up front with
// empty_moov+default_base_moof+frag_custom. Codecs whose sample entry needs
// bitstream info the muxer only has after a packet (AC-3's dac3, E-AC-3's dec3)
// fail here, which is the whole reason Dolby cannot currently be copied.
static void try_mux(enum AVCodecID id, const char *label, int extradata_size) {
  AVFormatContext *out = NULL;
  if (avformat_alloc_output_context2(&out, NULL, "mp4", NULL) < 0) return;

  AVStream *st = avformat_new_stream(out, NULL);
  st->codecpar->codec_type = AVMEDIA_TYPE_AUDIO;
  st->codecpar->codec_id = id;
  st->codecpar->sample_rate = 48000;
  st->codecpar->format = AV_SAMPLE_FMT_S32P;
  st->codecpar->bits_per_raw_sample = 24;
  av_channel_layout_default(&st->codecpar->ch_layout, 6);
  if (extradata_size > 0) {
    st->codecpar->extradata = av_mallocz(extradata_size + AV_INPUT_BUFFER_PADDING_SIZE);
    st->codecpar->extradata_size = extradata_size;
  }

  if (avio_open(&out->pb, "/dev/null", AVIO_FLAG_WRITE) < 0) {
    avformat_free_context(out);
    return;
  }

  AVDictionary *opts = NULL;
  av_dict_set(&opts, "movflags", "empty_moov+default_base_moof+frag_custom", 0);
  int ret = avformat_write_header(out, &opts);
  av_dict_free(&opts);

  char err[128];
  av_strerror(ret, err, sizeof err);
  printf("  %-28s -> %s%s\n", label, ret >= 0 ? "HEADER OK" : "FAILED: ", ret >= 0 ? "" : err);

  avio_closep(&out->pb);
  avformat_free_context(out);
}

int main(void) {
  av_log_set_level(AV_LOG_FATAL); // the interesting failures are reported below, not logged

  printf("== build ==\n  %s\n\n", av_version_info());

  printf("== registered audio encoders ==\n ");
  void *it = NULL;
  const AVCodec *c;
  int n = 0;
  while ((c = av_codec_iterate(&it))) {
    if (av_codec_is_encoder(c) && c->type == AVMEDIA_TYPE_AUDIO) printf("%s%s", n++ ? ", " : " ", c->name);
  }
  printf("\n  (%d audio encoders)\n\n", n);

  // Decoders matter as much as encoders and are just as easy to get wrong from
  // the configure line: the build allowlists them explicitly, and only
  // av_codec_iterate says which ones survived. Subtitle decoders are listed on
  // their own because in-app PGS rendering depends on pgssub being real.
  printf("== registered decoders by type ==\n");
  for (int t = 0; t < 3; t++) {
    const enum AVMediaType type = t == 0 ? AVMEDIA_TYPE_VIDEO : t == 1 ? AVMEDIA_TYPE_AUDIO : AVMEDIA_TYPE_SUBTITLE;
    const char *label = t == 0 ? "video" : t == 1 ? "audio" : "subtitle";
    it = NULL;
    n = 0;
    printf("  %-9s", label);
    while ((c = av_codec_iterate(&it))) {
      if (av_codec_is_decoder(c) && c->type == type) printf("%s%s", n++ ? ", " : " ", c->name);
    }
    printf("\n            (%d)\n", n);
  }

  printf("\n== decoders the engine depends on ==\n");
  const char *decoders[] = {"pgssub", "dvdsub", "dvbsub", "xsub", "ass", "subrip", "webvtt", "truehd", "dca", "eac3", "flac", NULL};
  for (int i = 0; decoders[i]; i++) {
    printf("  %-10s %s\n", decoders[i], avcodec_find_decoder_by_name(decoders[i]) ? "registered" : "NOT REGISTERED");
  }
  printf("\n");

  const char *names[] = {"aac", "aac_at", "alac", "alac_at", "flac", "ac3", "eac3", NULL};

  printf("== constraints ==\n");
  for (int i = 0; names[i]; i++) {
    const AVCodec *e = avcodec_find_encoder_by_name(names[i]);
    if (e) describe(e);
    else printf("  %-10s NOT REGISTERED\n", names[i]);
  }

  printf("\n== avcodec_open2 with av_channel_layout_default(), as AudioTranscoder does ==\n");
  for (int i = 0; names[i]; i++) {
    const AVCodec *e = avcodec_find_encoder_by_name(names[i]);
    if (!e) continue;
    try_open(e, 6);
    try_open(e, 8);
  }

  printf("\n== the app's selection path for a 5.1 source ==\n");
  const AVCodec *chosen = avcodec_find_encoder_by_name("aac_at");
  printf("  aac_at %s\n", chosen ? "IS registered -> AudioTranscoder selects it" : "NOT registered -> falls back to software aac");
  if (!chosen) chosen = avcodec_find_encoder(AV_CODEC_ID_AAC);
  printf("  chosen: %s\n", chosen ? chosen->name : "none");
  try_open(chosen, 6);

  printf("\n== mp4 muxer, empty_moov+default_base_moof+frag_custom ==\n");
  try_mux(AV_CODEC_ID_ALAC, "ALAC (magic cookie)", 36);
  try_mux(AV_CODEC_ID_FLAC, "FLAC (34-byte STREAMINFO)", 34);
  try_mux(AV_CODEC_ID_AAC, "AAC (control)", 0);
  try_mux(AV_CODEC_ID_AC3, "AC-3 copy", 0);
  try_mux(AV_CODEC_ID_EAC3, "E-AC-3 copy", 0);

  return 0;
}
