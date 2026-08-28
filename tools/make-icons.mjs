/* One-off: rasterises public/favicon.svg into the icon files that browsers actually ask for.
   Run from the worktree root:  node <this file>
   Re-run it if favicon.svg changes; the outputs are committed, not generated at boot.

   Everything lands in public/ rather than admin/, deliberately. /admin sits behind Basic Auth
   (server/index.js), and the fetches for a notification's icon and badge are made by the browser
   outside the page's credential context -- an icon under /admin comes back 401 and the
   notification renders with a blank grey square. public/ is served unauthenticated at the root. */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const pub = path.resolve("public");
const svg = fs.readFileSync(path.join(pub, "favicon.svg"));

const png = (size, input = svg) =>
  sharp(input, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

/* The wheel on its own, no rust ground. Two consumers: Android's status-bar badge, which keeps
   only the alpha channel and paints it white (a coloured badge shows up as a grey blob), and the
   maskable icon below, which has to survive being cropped to a circle. */
const wheelOnly = (stroke) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <g stroke="${stroke}" stroke-width="7" fill="none" stroke-linecap="round">
    <circle cx="32" cy="32" r="21"/>
    <line x1="32" y1="11" x2="32" y2="53"/>
    <line x1="11" y1="32" x2="53" y2="32"/>
    <line x1="17.1" y1="17.1" x2="46.9" y2="46.9"/>
    <line x1="46.9" y1="17.1" x2="17.1" y2="46.9"/>
  </g>
  <circle cx="32" cy="32" r="8" fill="${stroke}"/>
</svg>`);

/* ICO container. Each entry points at a PNG payload, which every browser since IE11 and every
   version of Windows still in service reads; the older BMP-with-AND-mask form buys nothing here
   and triples the size. A dimension byte of 0 would mean 256 -- not needed at these sizes. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);          // reserved
  header.writeUInt16LE(1, 2);          // 1 = icon
  header.writeUInt16LE(images.length, 4);

  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, buf }) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(size, 0);             // width
    e.writeUInt8(size, 1);             // height
    e.writeUInt8(0, 2);                // palette size, 0 for truecolour
    e.writeUInt8(0, 3);                // reserved
    e.writeUInt16LE(1, 4);             // colour planes
    e.writeUInt16LE(32, 6);            // bits per pixel
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += buf.length;
    return e;
  });

  return Buffer.concat([header, ...entries, ...images.map((i) => i.buf)]);
}

const sizes = [16, 32, 48];
const images = await Promise.all(sizes.map(async (size) => ({ size, buf: await png(size) })));

fs.writeFileSync(path.join(pub, "favicon.ico"), ico(images));
fs.writeFileSync(path.join(pub, "apple-touch-icon.png"), await png(180));

/* Manifest + notification icons. */
fs.writeFileSync(path.join(pub, "icon-192.png"), await png(192));
fs.writeFileSync(path.join(pub, "icon-512.png"), await png(512));
fs.writeFileSync(path.join(pub, "badge-96.png"), await png(96, wheelOnly("#ffffff")));

/* Maskable: Android crops an adaptive icon to whatever shape the launcher uses, so only the
   middle 80% is guaranteed to survive. Full-bleed rust with the wheel inset into that safe zone,
   instead of the rounded-rect favicon, which would lose its corners to the crop. */
const MASK = 512;
const safe = Math.round(MASK * 0.8);
fs.writeFileSync(
  path.join(pub, "icon-maskable-512.png"),
  await sharp({
    create: { width: MASK, height: MASK, channels: 4, background: "#8c3a2b" },
  })
    .composite([{ input: await png(safe, wheelOnly("#f7ecd8")), top: (MASK - safe) / 2, left: (MASK - safe) / 2 }])
    .png({ compressionLevel: 9 })
    .toBuffer()
);

for (const f of [
  "favicon.ico",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "badge-96.png",
]) {
  console.log(f, fs.statSync(path.join(pub, f)).size, "bytes");
}
