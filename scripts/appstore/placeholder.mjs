/**
 * Stand-in captures. Every configured shot renders, a missing screenshot is visible in the
 * contact sheet, and the stand-in itself carries everything needed to go take the real one.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { COLORS } from "./palette.mjs";
import { fitSize, loadFont, typeset } from "./typeset.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FONTS = path.join(ROOT, "applestore", "fonts");
const display = loadFont(path.join(FONTS, "ScienceGothic-CndBlk.ttf"));
const mono = loadFont(path.join(FONTS, "IBMPlexMono-SemiBold.ttf"));

/** The app's own dark, shifted cool so a stand-in never reads as a real screen. */
const FIELD = "#171A21";
const RULE = "#2C3140";

/** Rounded warning triangle with the bar and dot knocked out of it. */
function warningPath(cx, cy, size) {
  const h = size * 0.88;
  const r = size * 0.06;
  const top = cy - h / 2;
  const bot = cy + h / 2;
  const half = size / 2;
  const tri = [
    `M ${cx} ${top}`,
    `Q ${cx + r} ${top + r * 0.4} ${cx + r * 0.9} ${top + r}`,
    `L ${cx + half - r * 0.4} ${bot - r * 1.2}`,
    `Q ${cx + half} ${bot} ${cx + half - r * 1.4} ${bot}`,
    `L ${cx - half + r * 1.4} ${bot}`,
    `Q ${cx - half} ${bot} ${cx - half + r * 0.4} ${bot - r * 1.2}`,
    `L ${cx - r * 0.9} ${top + r}`,
    `Q ${cx - r} ${top + r * 0.4} ${cx} ${top}`,
    "Z",
  ].join(" ");
  const barW = size * 0.055;
  const bar = `M ${cx - barW} ${cy - h * 0.16} L ${cx + barW} ${cy - h * 0.16} L ${cx + barW * 0.8} ${cy + h * 0.14} L ${cx - barW * 0.8} ${cy + h * 0.14} Z`;
  const dotR = size * 0.055;
  const dotY = cy + h * 0.28;
  const dot = `M ${cx - dotR} ${dotY} a ${dotR} ${dotR} 0 1 0 ${dotR * 2} 0 a ${dotR} ${dotR} 0 1 0 ${-dotR * 2} 0 Z`;
  return { tri, cut: `${bar} ${dot}` };
}

/** The deep link exactly as the config declares it, tokens left unresolved on purpose. */
function routeOf(shot) {
  const spec = shot.capture;
  if (!spec?.path) return "(no capture.path in shots.config.json)";
  const query = Object.entries(spec.params ?? {})
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return `tomotv://${spec.path}${query ? `?${query}` : ""}`;
}

/** Break after spaces and URL separators, so a route wraps where a reader expects it to. */
function wrap(text, max) {
  const tokens = String(text)
    .split(/(?<=[ &?/])/)
    .filter(Boolean);
  const out = [];
  for (const token of tokens) {
    if (out.length && (out.at(-1) + token).length <= max) out[out.length - 1] += token;
    else out.push(token);
  }
  return out.flatMap((line) => (line.length <= max ? [line] : (line.match(new RegExp(`.{1,${max}}`, "g")) ?? [line]))).map((l) => l.trimEnd());
}

export async function renderPlaceholder({ canvas, simulator, deviceKey, shot, relPath }, file) {
  const [W, H] = canvas;
  const short = Math.min(W, H);
  const cx = W / 2;
  const margin = W * 0.09;
  const box = W - margin * 2;

  const mark = short * 0.075;
  const { tri, cut } = warningPath(cx, H * 0.085, mark);
  const stampSize = fitSize(display, ["CAPTURE PENDING"], short * 0.038, 0.08, box);
  const stamp = typeset(display, ["CAPTURE PENDING"], { size: stampSize, tracking: 0.08, align: "center", boxWidth: W, y: H * 0.085 + mark * 0.75 });

  // The caption is what the shot has to show, so it is the hero, in the poster's own two
  // tones: the second line carries the accent exactly as compose draws it.
  const titleLines = (shot.title ?? shot.id).split("\n");
  const titleSize = fitSize(display, titleLines, short * 0.115, 0.01, box);
  const title = typeset(display, titleLines, { size: titleSize, tracking: 0.01, lineHeight: 1.04, align: "center", boxWidth: W, y: H * 0.2 });

  const specSize = fitSize(display, [shot.spec ?? ""], titleSize * 0.34, 0.02, box);
  const spec = shot.spec ? typeset(display, [shot.spec], { size: specSize, tracking: 0.02, align: "center", boxWidth: W, y: H * 0.2 + title.height + short * 0.035 }) : null;

  const rows = [
    ["SHOT", shot.id],
    ["DEVICE", `${deviceKey}  ${simulator}`],
    ["CANVAS", `${W} x ${H}`],
    ["ROUTE", routeOf(shot)],
    ["SAVE AS", relPath],
  ];
  const bodySize = short * 0.024;
  const cols = Math.max(28, Math.floor(box / (bodySize * 0.62)));
  const lines = [];
  for (const [key, value] of rows) {
    const wrapped = wrap(value, cols - 10);
    lines.push(`${key.padEnd(9)}${wrapped[0]}`);
    for (const extra of wrapped.slice(1)) lines.push(`${" ".repeat(9)}${extra}`);
  }

  const detailTop = H * 0.2 + title.height + (spec ? spec.height + short * 0.035 : 0) + short * 0.11;
  const body = typeset(mono, lines, { size: bodySize, tracking: 0.02, lineHeight: 1.85, align: "left", x: margin, y: detailTop });
  const helpTop = detailTop + body.height + short * 0.07;
  const help = typeset(mono, wrap("Take this screen in the simulator, save the PNG over the path above, then re-run npm run shots. Any file that differs from this one counts as captured.", cols), {
    size: bodySize * 0.86,
    tracking: 0.02,
    lineHeight: 1.7,
    align: "left",
    x: margin,
    y: helpTop,
  });

  const titleInk = title.lineData.map((d, i) => `<path d="${d}" fill="${i === 0 ? COLORS.TEXT_PRIMARY : COLORS.ACCENT}"/>`).join("\n  ");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs><radialGradient id="v" cx="50%" cy="24%" r="82%">
    <stop offset="0%" stop-color="#232735"/><stop offset="100%" stop-color="${FIELD}"/>
  </radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#v)"/>
  <path d="${tri}" fill="${COLORS.ACCENT}"/>
  <path d="${cut}" fill="${FIELD}"/>
  <path d="${stamp.d}" fill="${COLORS.TEXT_SECONDARY}"/>
  ${titleInk}
  ${spec ? `<path d="${spec.d}" fill="${COLORS.TEXT_SECONDARY}"/>` : ""}
  <rect x="${margin}" y="${detailTop - short * 0.045}" width="${box}" height="2" fill="${RULE}"/>
  <path d="${body.d}" fill="${COLORS.TEXT_PRIMARY}"/>
  <rect x="${margin}" y="${helpTop - short * 0.035}" width="${box}" height="2" fill="${RULE}"/>
  <path d="${help.d}" fill="${COLORS.TEXT_SECONDARY}"/>
</svg>`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(Buffer.from(svg)).png().toFile(file);
  return file;
}

const MANIFEST = ".placeholders.json";
const sha = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * Fill every configured slot that has no capture, and report which are still stand-ins.
 * A slot counts as captured the moment its bytes stop matching what we wrote, so replacing
 * a file is the whole handover: no flag to set, and re-running changes nothing.
 */
export async function ensurePlaceholders(plan, captureDir, deviceInfo) {
  const manifestPath = path.join(captureDir, MANIFEST);
  const previous = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, "utf8")) : {};
  const next = {};
  const written = [];
  const pending = [];
  let real = 0;

  for (const { deviceKey, shots } of plan) {
    const info = deviceInfo(deviceKey);
    for (const shot of shots) {
      const key = `${deviceKey}/${shot.id}`;
      const file = path.join(captureDir, deviceKey, `${shot.id}.png`);

      if (fs.existsSync(file)) {
        if (previous[key] && previous[key] === sha(file)) {
          next[key] = previous[key];
          pending.push(key);
        } else {
          real++;
        }
        continue;
      }

      await renderPlaceholder({ ...info, deviceKey, shot, relPath: path.relative(ROOT, file) }, file);
      next[key] = sha(file);
      written.push(key);
      pending.push(key);
    }
  }

  fs.mkdirSync(captureDir, { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`);
  return { written, pending, real };
}
