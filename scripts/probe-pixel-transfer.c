//
//  probe-pixel-transfer.c
//
//  Proves the conversion VideoTranscoder relies on, against the real system
//  frameworks: FFmpeg's decoded planes wrapped as a CVPixelBuffer and converted
//  by a VTPixelTransferSession into what h264_videotoolbox/hevc_videotoolbox
//  take.
//
//  This covers the ZERO-COPY path only: the three layouts VideoTranscoder wraps
//  straight out of the decoder (yuv420p, yuvj420p, nv12), which is every MPEG-2,
//  MPEG-4, VP8/9, WMV, H.263, RV and FLV source. Everything else now goes
//  through libswscale instead — it is vendored again, since we build FFmpeg
//  ourselves and no longer inherit MPVKit's Vulkan-enabled swscale.
//
//  Run with `npm run probe:pixel-transfer`.
//
#include <VideoToolbox/VideoToolbox.h>
#include <CoreVideo/CoreVideo.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define W 640
#define H 480

static int failures = 0;

static void planarRelease(void *ro, const void *d, size_t s, size_t n, const void *p[]) {}
static void flatRelease(void *ro, const void *b) {}

static void check(const char *what, int ok) {
  printf("  %-46s %s\n", what, ok ? "PASS" : "FAIL");
  if (!ok) failures++;
}

/* Transfer src into a freshly made destination of `dstFormat`, and hand back
   the destination so the caller can look at the pixels. */
static CVPixelBufferRef transfer(CVPixelBufferRef src, OSType dstFormat) {
  CVPixelBufferRef dst = NULL;
  if (CVPixelBufferCreate(kCFAllocatorDefault, W, H, dstFormat, NULL, &dst) != kCVReturnSuccess) return NULL;
  VTPixelTransferSessionRef session = NULL;
  if (VTPixelTransferSessionCreate(kCFAllocatorDefault, &session) != noErr) { CFRelease(dst); return NULL; }
  OSStatus s = VTPixelTransferSessionTransferImage(session, src, dst);
  VTPixelTransferSessionInvalidate(session);
  CFRelease(session);
  if (s != noErr) { CFRelease(dst); return NULL; }
  return dst;
}

/* A left-to-right luma ramp survives any correct conversion, so it is the
   cheapest proof that pixels moved rather than merely that a status was noErr. */
static int lumaRampSurvived(CVPixelBufferRef dst) {
  CVPixelBufferLockBaseAddress(dst, kCVPixelBufferLock_ReadOnly);
  const uint8_t *y = CVPixelBufferGetBaseAddressOfPlane(dst, 0);
  int ok = y && y[0] < y[W / 2] && y[W / 2] < y[W - 1];
  CVPixelBufferUnlockBaseAddress(dst, kCVPixelBufferLock_ReadOnly);
  return ok;
}

/* AV_PIX_FMT_YUV420P / YUVJ420P: three 8-bit planes, wrapped with no copy. */
static void testPlanar420(void) {
  uint8_t *y = malloc(W * H), *u = malloc(W * H / 4), *v = malloc(W * H / 4);
  for (int j = 0; j < H; j++) for (int i = 0; i < W; i++) y[j * W + i] = (uint8_t)(i * 255 / W);
  memset(u, 90, W * H / 4);
  memset(v, 170, W * H / 4);

  void *bases[3] = { y, u, v };
  size_t widths[3] = { W, W / 2, W / 2 }, heights[3] = { H, H / 2, H / 2 }, strides[3] = { W, W / 2, W / 2 };
  CVPixelBufferRef src = NULL;
  OSStatus s = CVPixelBufferCreateWithPlanarBytes(kCFAllocatorDefault, W, H,
      kCVPixelFormatType_420YpCbCr8Planar, NULL, 0, 3, bases, widths, heights, strides,
      planarRelease, NULL, NULL, &src);
  check("yuv420p wraps as 'y420' with no copy", s == kCVReturnSuccess);
  if (s != kCVReturnSuccess) return;

  CVPixelBufferRef dst = transfer(src, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange);
  check("yuv420p -> nv12 transfers", dst != NULL);
  if (dst) { check("yuv420p -> nv12 keeps the luma ramp", lumaRampSurvived(dst)); CFRelease(dst); }
  CFRelease(src);
  free(y); free(u); free(v);
}

/* AV_PIX_FMT_YUV420P10LE: 10 bits in the LOW bits across three planes. p010
   wants them in the HIGH bits across two, so shift 6 and weave U/V. */
static void testPlanar10Bit(void) {
  int cw = W / 2, ch = H / 2;
  uint16_t *py = malloc(W * H * 2), *puv = malloc(cw * ch * 4);
  for (int j = 0; j < H; j++) for (int i = 0; i < W; i++) py[j * W + i] = (uint16_t)((i * 1023 / W) << 6);
  for (int k = 0; k < cw * ch; k++) { puv[2 * k] = 300 << 6; puv[2 * k + 1] = 700 << 6; }

  void *bases[2] = { py, puv };
  size_t widths[2] = { W, cw }, heights[2] = { H, ch }, strides[2] = { W * 2, cw * 4 };
  CVPixelBufferRef src = NULL;
  OSStatus s = CVPixelBufferCreateWithPlanarBytes(kCFAllocatorDefault, W, H,
      kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange, NULL, 0, 2, bases, widths, heights, strides,
      planarRelease, NULL, NULL, &src);
  check("10-bit weaves into 'x420' (p010)", s == kCVReturnSuccess);
  if (s != kCVReturnSuccess) return;

  CVPixelBufferRef dst = transfer(src, kCVPixelFormatType_420YpCbCr10BiPlanarVideoRange);
  check("p010 -> p010 transfers (hevc_videotoolbox input)", dst != NULL);
  if (dst) CFRelease(dst);
  CFRelease(src);
  free(py); free(puv);
}

/* AV_PIX_FMT_YUV422P / YUVJ422P: no 8-bit planar 4:2:2 type exists here, so
   pack to '2vuy' (UYVY). This is MJPEG, FFV1 and HuffYUV. */
static void testPacked422(void) {
  int cw = W / 2;
  uint8_t *y = malloc(W * H), *u = malloc(cw * H), *v = malloc(cw * H), *uyvy = malloc(W * H * 2);
  for (int j = 0; j < H; j++) for (int i = 0; i < W; i++) y[j * W + i] = (uint8_t)(i * 255 / W);
  memset(u, 90, cw * H);
  memset(v, 170, cw * H);
  for (int j = 0; j < H; j++) for (int i = 0; i < cw; i++) {
    uint8_t *o = uyvy + j * W * 2 + i * 4;
    o[0] = u[j * cw + i]; o[1] = y[j * W + 2 * i];
    o[2] = v[j * cw + i]; o[3] = y[j * W + 2 * i + 1];
  }
  CVPixelBufferRef src = NULL;
  OSStatus s = CVPixelBufferCreateWithBytes(kCFAllocatorDefault, W, H,
      kCVPixelFormatType_422YpCbCr8, uyvy, W * 2, flatRelease, NULL, NULL, &src);
  check("4:2:2 packs into '2vuy'", s == kCVReturnSuccess);
  if (s != kCVReturnSuccess) return;

  CVPixelBufferRef dst = transfer(src, kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange);
  check("4:2:2 -> nv12 transfers", dst != NULL);
  if (dst) { check("4:2:2 -> nv12 keeps the luma ramp", lumaRampSurvived(dst)); CFRelease(dst); }
  CFRelease(src);
  free(y); free(u); free(v); free(uyvy);
}

int main(void) {
  printf("Pixel-transfer probe (the conversion VideoTranscoder depends on)\n\n");
  testPlanar420();
  testPlanar10Bit();
  testPacked422();
  printf("\n%s\n", failures ? "FAILED" : "All conversions available.");
  return failures ? 1 : 0;
}
