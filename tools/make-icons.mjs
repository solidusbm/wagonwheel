/* One-off: rasterises public/favicon.svg into the icon files that browsers actually ask for.
   Run from the worktree root:  node <this file>
   Re-run it if favicon.svg changes; the outputs are committed, not generated at boot. */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const pub = path.resolve("public");
const svg = fs.readFileSync(path.join(pub, "favicon.svg"));

const png = (size) => sharp(svg, { density: 384 }).resize(size, size).png({ compressionLevel: 9 }).toBuffer();

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

for (const f of ["favicon.ico", "apple-touch-icon.png"]) {
  console.log(f, fs.statSync(path.join(pub, f)).size, "bytes");
}
