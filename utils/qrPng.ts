/**
 * A minimal PNG writer for QR codes: 1-bit indexed colour, two palette entries, the
 * background fully transparent. Deflate is written as stored (uncompressed) blocks, so this
 * needs no compression library, and at one bit per pixel the whole image is a few tens of
 * kilobytes. One <Image> replaces the thousand views a module-per-view QR would mount.
 */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(bytes: number[], start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function adler32(bytes: number[]): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

function pushU32(out: number[], value: number): void {
  out.push((value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff);
}

function chunk(out: number[], type: string, data: number[]): void {
  pushU32(out, data.length);
  const start = out.length;
  for (let i = 0; i < type.length; i++) out.push(type.charCodeAt(i));
  for (let i = 0; i < data.length; i++) out.push(data[i]);
  pushU32(out, crc32(out, start, out.length));
}

/** zlib stream around stored deflate blocks: no compression, no dependency. */
function zlibStored(raw: number[]): number[] {
  const out: number[] = [0x78, 0x01];
  const MAX = 65535;
  for (let offset = 0; offset < raw.length; offset += MAX) {
    const len = Math.min(MAX, raw.length - offset);
    const final = offset + len >= raw.length ? 1 : 0;
    out.push(final, len & 0xff, (len >>> 8) & 0xff, ~len & 0xff, (~len >>> 8) & 0xff);
    for (let i = 0; i < len; i++) out.push(raw[offset + i]);
  }
  pushU32(out, adler32(raw));
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | ((b1 ?? 0) >> 4)];
    out += b1 === undefined ? "=" : B64[((b1 & 15) << 2) | ((b2 ?? 0) >> 6)];
    out += b2 === undefined ? "=" : B64[b2 & 63];
  }
  return out;
}

/**
 * A data URI for the matrix, `scale` pixels per module, drawn in `rgb` on transparency.
 * `isDark(row, col)` reports a module.
 */
export function qrPngDataUri(count: number, isDark: (row: number, col: number) => boolean, scale: number, rgb: [number, number, number]): string {
  const size = count * scale;
  const bytesPerRow = Math.ceil(size / 8);

  const raw: number[] = [];
  for (let y = 0; y < size; y++) {
    const row = Math.floor(y / scale);
    raw.push(0); // filter: none
    for (let byte = 0; byte < bytesPerRow; byte++) {
      let bits = 0;
      for (let bit = 0; bit < 8; bit++) {
        const x = byte * 8 + bit;
        const on = x < size && isDark(row, Math.floor(x / scale));
        bits = (bits << 1) | (on ? 1 : 0);
      }
      raw.push(bits);
    }
  }

  const png: number[] = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr: number[] = [];
  pushU32(ihdr, size);
  pushU32(ihdr, size);
  ihdr.push(1, 3, 0, 0, 0); // bit depth 1, colour type 3 (indexed), no interlace
  chunk(png, "IHDR", ihdr);
  // Index 0 is the transparent background, index 1 the module colour.
  chunk(png, "PLTE", [0, 0, 0, rgb[0], rgb[1], rgb[2]]);
  chunk(png, "tRNS", [0]);
  chunk(png, "IDAT", zlibStored(raw));
  chunk(png, "IEND", []);

  return `data:image/png;base64,${base64(png)}`;
}
