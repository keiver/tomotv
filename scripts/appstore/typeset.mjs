/**
 * Captions as glyph outlines.
 *
 * librsvg (sharp's SVG path) resolves no font we can ship: SF Pro, Inter and a
 * base64 @font-face all fall back to one default face, letter-spacing and
 * textLength are ignored, and FONTCONFIG_FILE has no effect. Outlines sidestep
 * all of it and render identically anywhere.
 */
import fs from "node:fs";
import opentype from "opentype.js";

// eslint-disable-next-line import/no-named-as-default-member -- Node resolves main, the CJS build, where `parse` is not a named export.
const { parse } = opentype;

/** Node Buffers can be views into a shared pool; hand opentype its own bytes. */
export function loadFont(file) {
  const buf = fs.readFileSync(file);
  return parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/**
 * Serialise a glyph outline ourselves.
 *
 * opentype.js 2.0.0's toPathData builds its rounding through string concat —
 * `Math.round(decimalPart + "e+" + places)`. A fractional part small enough to
 * stringify as "1e-7" yields "1e-7e+2" and rounds to NaN, and the result is
 * cached, so one bad coordinate poisons every later one. librsvg then draws the
 * path up to the first NaN and drops the rest: a headline rendered as a single
 * letter. It hits about 10% of font sizes, so it cannot be rounded away.
 */
function pathData(path, places = 2) {
  const n = (v) => {
    if (!Number.isFinite(v)) throw new Error(`Glyph outline produced ${v}`);
    return String(Math.round(v * 10 ** places) / 10 ** places);
  };
  let d = "";
  for (const c of path.commands) {
    if (c.type === "M") d += `M${n(c.x)} ${n(c.y)}`;
    else if (c.type === "L") d += `L${n(c.x)} ${n(c.y)}`;
    else if (c.type === "C") d += `C${n(c.x1)} ${n(c.y1)} ${n(c.x2)} ${n(c.y2)} ${n(c.x)} ${n(c.y)}`;
    else if (c.type === "Q") d += `Q${n(c.x1)} ${n(c.y1)} ${n(c.x)} ${n(c.y)}`;
    else if (c.type === "Z") d += "Z";
  }
  return d;
}

/** Distance from baseline to cap top, in em. Display caps are set on this, not on the em box. */
export function capRatio(font) {
  const cap = font.tables.os2?.sCapHeight;
  if (cap) return cap / font.unitsPerEm;
  const h = font.charToGlyph("H").getMetrics();
  return h.yMax / font.unitsPerEm;
}

/**
 * Glyph positions for one line, with kerning and tracking.
 *
 * `tracking` is in em, the way a type spec states it. opentype's own getPath
 * kerns but cannot track, so the run is laid out a glyph at a time.
 */
export function layoutLine(font, text, size, tracking = 0) {
  const scale = size / font.unitsPerEm;
  const track = tracking * size;
  const glyphs = font.stringToGlyphs(text);
  const positions = [];
  let x = 0;
  for (let i = 0; i < glyphs.length; i++) {
    positions.push({ glyph: glyphs[i], x });
    let advance = glyphs[i].advanceWidth * scale;
    if (i + 1 < glyphs.length) advance += font.getKerningValue(glyphs[i], glyphs[i + 1]) * scale;
    x += advance + track;
  }
  return { positions, width: glyphs.length ? x - track : 0, size };
}

/** Largest size at or below `size` whose longest line fits `maxWidth`. */
export function fitSize(font, lines, size, tracking, maxWidth) {
  const widest = Math.max(...lines.map((l) => layoutLine(font, l, size, tracking).width), 1);
  return widest <= maxWidth ? size : (size * maxWidth) / widest;
}

/**
 * A text block as one SVG path string, plus the box it actually occupies.
 *
 * `align` positions each line inside `boxWidth`; the returned x/y are the ink
 * bounds, which is what a caller needs to centre a block against a plate rather
 * than against the font's em box.
 */
export function typeset(font, lines, { size, tracking = 0, lineHeight = 1.16, x = 0, y = 0, align = "left", boxWidth = 0 }) {
  const cap = capRatio(font) * size;
  const step = size * lineHeight;
  const laid = lines.map((line) => layoutLine(font, line, size, tracking));
  const blockWidth = Math.max(...laid.map((l) => l.width), 0);
  const commands = [];

  laid.forEach((line, i) => {
    const room = boxWidth || blockWidth;
    const offset = align === "center" ? (room - line.width) / 2 : align === "right" ? room - line.width : 0;
    const baseline = y + cap + i * step;
    for (const { glyph, x: gx } of line.positions) {
      const d = pathData(glyph.getPath(x + offset + gx, baseline, size));
      if (d) commands.push(d);
    }
  });

  return {
    d: commands.join(" "),
    width: blockWidth,
    height: cap + (lines.length - 1) * step,
    capHeight: cap,
    lineStep: step,
    lineWidths: laid.map((l) => l.width),
  };
}
