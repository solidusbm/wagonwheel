import sharp from "sharp";

/* Photos come straight off a phone and are stored as BYTEA, then served raw -- so a homepage grid
 * of thumbnails was pulling 8.4MB of originals down the wire before any text rendered. That is a
 * poor first impression for an audience frequently on cellular in the Hill Country, and the
 * database grows by about a megabyte per upload.
 *
 * Measured on the 2026-08-11 shoot, the weight is COMPRESSION, not dimensions: those files are
 * only 1000-1350px wide but around a megabyte each, and re-encoding alone takes 65-69% off them.
 * So the width cap below rarely fires for phone photos -- it is a guard against someone later
 * uploading from a real camera, not the main saving. Don't "optimise" it away on the grounds that
 * it appears to do nothing.
 *
 * 1600px is comfortably wider than any slot the site displays, including a full-width hero on a
 * retina laptop. Quality 82 with mozjpeg is where JPEG stops being visibly lossy for photographic
 * content.
 *
 * withoutEnlargement leaves an already-small image at its own size rather than upscaling it into a
 * bigger file, and rotate() applies the EXIF orientation before that tag is stripped -- without it,
 * portrait phone shots come out sideways.
 */
export const MAX_WIDTH = 1600;
export const JPEG_QUALITY = 82;

export async function shrinkImage(buffer) {
  const before = buffer.length;
  const image = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await image.metadata();

  const out = await image
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  // Re-encoding a small or already-optimised image can make it bigger. Keep whichever is smaller,
  // but only keep the original if it needed no rotation -- otherwise it would serve sideways.
  const needsRotation = (meta.orientation ?? 1) !== 1;
  const keepOriginal = !needsRotation && out.length >= before;

  return {
    buffer: keepOriginal ? buffer : out,
    mimeType: keepOriginal ? null : "image/jpeg",
    before,
    after: keepOriginal ? before : out.length,
    width: meta.width ?? null,
    resized: !keepOriginal,
  };
}
