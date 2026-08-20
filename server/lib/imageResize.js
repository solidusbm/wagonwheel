import sharp from "sharp";
import convertHeic from "heic-convert";

/* This deployment's libvips is built without HEIC decoding -- only its royalty-free sibling AVIF
 * (HEIC's video codec, HEVC, is patent-licensed and most prebuilt sharp/libvips binaries, including
 * this one, ship without it: `sharp.format.heif.input.fileSuffix` here is `[".avif"]`, not HEIC).
 * So sharp(buffer) on a HEIC file -- the default iPhone camera format since iOS 11 -- fails outright,
 * with no way to recover inside sharp itself. heic-convert wraps a WASM build of libheif that CAN
 * decode HEIC, and is used ONLY to get a JPEG buffer that sharp can then process normally below; it
 * plays no other part in this pipeline.
 *
 * Detected by content, not by the browser-supplied filename or mimetype -- both are client-asserted
 * and HEIC in particular is reported inconsistently (some browsers send "image/heic", others fall
 * back to "application/octet-stream" for a type they don't recognise). An HEIC/HEIF file is an
 * ISO-BMFF container: bytes 4-7 spell "ftyp" and bytes 8-11 name the major brand. */
const HEIC_BRANDS = new Set(["heic", "heix", "heim", "heis", "hevc", "hevm", "hevs", "hevx", "mif1", "msf1"]);

function isHeic(buffer) {
  if (buffer.length < 12) return false;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  return HEIC_BRANDS.has(buffer.toString("ascii", 8, 12));
}

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

  // HEIC can't reach sharp at all -- convert to JPEG first, then fall into the normal pipeline
  // below exactly as if that JPEG had been uploaded directly. A HEIC source therefore always
  // returns a JPEG (never "kept original"): there's no HEIC-shaped buffer to keep.
  const sourceIsHeic = isHeic(buffer);
  const sourceBuffer = sourceIsHeic
    ? await convertHeic({ buffer, format: "JPEG", quality: JPEG_QUALITY / 100 })
    : buffer;

  const image = sharp(sourceBuffer, { failOn: "none" }).rotate();
  const meta = await image.metadata();

  const out = await image
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();

  // Re-encoding a small or already-optimised image can make it bigger. Keep whichever is smaller,
  // but only keep the original if it needed no rotation -- otherwise it would serve sideways. A
  // converted HEIC is never "the original" in this sense (there's no HEIC-shaped buffer worth
  // keeping), so it always takes the freshly resized+re-encoded JPEG.
  const needsRotation = (meta.orientation ?? 1) !== 1;
  const keepOriginal = !sourceIsHeic && !needsRotation && out.length >= before;

  return {
    buffer: keepOriginal ? buffer : out,
    mimeType: keepOriginal ? null : "image/jpeg",
    before,
    after: keepOriginal ? before : out.length,
    width: meta.width ?? null,
    resized: !keepOriginal,
  };
}
