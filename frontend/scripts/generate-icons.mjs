// Single source of truth for the app's baseball icon family. Regenerate with:
//
//   cd frontend && npm i sharp --no-save && node scripts/generate-icons.mjs
//
// Writes public/favicon.svg (tab icon, rounded tile) and the raster home-screen / PWA icons
// public/apple-touch-icon.png (iOS) + icon-192/512.png (web manifest). The PNG tiles are
// FULL-BLEED squares with an opaque background and NO rounded corners on purpose - iOS and
// Android apply their own corner mask, and the baseball sits within the center ~80% so it stays
// clear of any maskable-icon safe-zone cropping.
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const outDir = join(dirname(fileURLToPath(import.meta.url)), "..", "public");
mkdirSync(outDir, { recursive: true });

const GREEN = "#26624d";
const CREAM = "#fbfaf5";
const SEAM = "#c8442f";
const CY = 256;
const BALL_R = 160;

// Each seam is a circular arc of radius SEAM_R whose chord is vertical (top/bottom of the ball).
const SEAM_R = 192;
const CHORD_HALF = 131.2; // half the vertical distance between the seam's endpoints
const CENTER_OFFSET = Math.sqrt(SEAM_R * SEAM_R - CHORD_HALF * CHORD_HALF); // 140.18
const HALF_RANGE = (Math.asin(CHORD_HALF / SEAM_R) * 180) / Math.PI; // ~43.1 deg
const rad = (deg) => (deg * Math.PI) / 180;

// Build short, slightly-slanted stitch ticks straddling one seam arc.
function stitches({ cx, baseAngle }) {
  const count = 9;
  const half = 15; // tick half-length
  const slant = 20; // degrees of lean, for the baseball look
  const inset = 6; // keep end ticks off the very tips of the seam
  const segs = [];
  for (let i = 0; i < count; i++) {
    const a = baseAngle - (HALF_RANGE - inset) + ((2 * (HALF_RANGE - inset)) * i) / (count - 1);
    const px = cx + SEAM_R * Math.cos(rad(a));
    const py = CY + SEAM_R * Math.sin(rad(a));
    const d = rad(a + slant); // near-radial => tick crosses the seam like a rung
    const dx = half * Math.cos(d);
    const dy = half * Math.sin(d);
    segs.push(
      `<line x1="${(px - dx).toFixed(1)}" y1="${(py - dy).toFixed(1)}" x2="${(px + dx).toFixed(1)}" y2="${(py + dy).toFixed(1)}"/>`
    );
  }
  return segs.join("");
}

// left seam bulges left (center to the right), right seam bulges right (center to the left)
const leftCx = 150.4 + CENTER_OFFSET;
const rightCx = 361.6 - CENTER_OFFSET;
const seamLines =
  `<g stroke="${SEAM}" stroke-width="4" fill="none" opacity="0.55">` +
  `<path d="M150.4 124.8 A ${SEAM_R} ${SEAM_R} 0 0 0 150.4 387.2"/>` +
  `<path d="M361.6 124.8 A ${SEAM_R} ${SEAM_R} 0 0 1 361.6 387.2"/></g>`;
const seamStitches =
  `<g stroke="${SEAM}" stroke-width="8" stroke-linecap="round">` +
  stitches({ cx: leftCx, baseAngle: 180 }) +
  stitches({ cx: rightCx, baseAngle: 0 }) +
  `</g>`;

function svg({ rounded }) {
  const bg = rounded
    ? `<rect width="512" height="512" rx="112" fill="${GREEN}"/>`
    : `<rect width="512" height="512" fill="${GREEN}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Assistant GM baseball">
  ${bg}
  <circle cx="256" cy="${CY}" r="${BALL_R}" fill="${CREAM}" stroke="#d7d2c0" stroke-width="6"/>
  ${seamLines}
  ${seamStitches}
</svg>`;
}

// Tab favicon (vector, rounded tile).
writeFileSync(join(outDir, "favicon.svg"), svg({ rounded: true }) + "\n");
console.log("wrote favicon.svg");

// Raster home-screen / PWA icons (full-bleed square).
const squareBuf = Buffer.from(svg({ rounded: false }));
const targets = [
  ["apple-touch-icon.png", 180],
  ["icon-192.png", 192],
  ["icon-512.png", 512],
];
for (const [name, size] of targets) {
  await sharp(squareBuf)
    .resize(size, size)
    .flatten({ background: GREEN }) // guarantee an opaque background (iOS ignores alpha)
    .png()
    .toFile(join(outDir, name));
  console.log(`wrote ${name} (${size}x${size})`);
}
