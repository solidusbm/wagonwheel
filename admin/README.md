# Print pieces for Bandera Wagon Wheel RV Park

Generated 2026-09-28 by the printables skill from `~/projects/wagonwheel` and https://banderawagonwheelrv.com/.
Facts: `brand-facts.yaml` (reviewed 2026-09-25). Regenerate by asking for it; hand edits to a piece survive re-runs.

Open any piece from disk (double-click) or at `/admin/<piece>.html` behind the admin login; fonts, photos and the QR
are all under `assets/` and `qr/` next to the pieces, so nothing depends on the live stylesheet. Since 2026-10-05 every
piece in this folder is linked from the **Materials** section of `/admin`, with a thumbnail from `thumbs/` and the PDF
from `render/`; a regenerated or new piece needs its thumbnail re-rendered and its card updated there.

## Pieces

- `business-card.html`: 3.5 × 2 in, 2 pages. Save as PDF with Margins at Default; Chrome hides the Paper size picker. One face per page. Front is rust with the wordmark and contact; back lists what every site includes, the rates line and the QR.
- `letter-flyer.html`: 8.5 × 11 in, 1 page. Margins at Default. Rust band with the caravan lockup, "Hill Country, without the drive", three photo columns (hookups, the park, the dog park), a rates box, the trust row, contact, office hours and the QR.
- `half-sheet-two-up.html`: 8.5 × 11 in, 1 page holding two 8.5 × 5.5 in flyers. Margins at Default. Cut along the dashed line. Sunset photo, military-discount badge, headline, rates, trust row, QR and phone.
- `tri-fold.html`: 11 × 8.5 in, 2 pages. Margins at Default. Print double-sided, flip on the short edge, fold the inner flap in first. Outside: monthly-stays flap, contact and hours back cover with the booking steps, front cover with the sign photo. Inside: about the park, six nearby stops, the twelve amenities and rates with the floodplain callout.
- `social-square.html`: 1080 × 1080 px, not a print piece. Capture as an image at 100% zoom. Rust, lockup, headline, lede, three points, phone and site.

Ready-made PDFs and screenshots from the headless render are in `render/` (the PDFs measure exactly the trim sizes above).

Skipped (already present, ask to regenerate): none. The older hand-made pieces in this folder (`brochure.html`, `review-flyer.html`, `summer-special-*.html`) are untouched.

## Facts to look at

- inferred: colors.roles.accent → rust `#8c3a2b` (favicon, RV PARK, buttons), gold `#87590f` recorded as secondary. Rust fails 3:1 on the dark ink, so reverse faces are rust with the site's cream text (`#f7ecd8`, 6.51:1) and hero-sky sand (`#f3d9a8`, 5.55:1) for graphics and small accent text.
- inferred: logo → the caravan lockup is rebuilt inline from the site's own SVG symbols and font files; no logo image exists in the repo or on the site. The business card uses the wordmark without the caravan (too small to read below about 24 px).
- missing (blocks dropped, nothing printed as a placeholder): reviews (none on the site), social links, legal name, licence.
- conflict resolved at review: copy.prices "Per month" — the hours page's $300–$350 was kept over the amenity row's "From 325/mo". That amenity row in `/admin` → Amenities is stale and worth fixing on the site.
- Rye ships one weight, so display type is set at 400 as on the site, not the templates' 700.

## Invented copy

- none. Every line is from the site or the repo; the only assembled lines are the rates line (three figures from the hours page joined with dots) and the Letter flyer's hours line.

## Verification

- QR `qr/banderawagonwheelrv-com.svg` → https://banderawagonwheelrv.com/ PASS
- contrast: ink/paper 13.93:1, accent-ink/paper 6.50:1, muted/paper 5.77:1; reverse face cream/rust 6.51:1, sand/rust 5.55:1
- placeholders: none (`grep data-missing` is empty)
- sheet lint: PASS, 5 files
- render: PASS, 5 files. PDFs at 252×144, 612×792, 612×792, 792×612 pt with 2, 1, 1, 2 pages. Fonts Rye, Zilla Slab and JetBrains Mono confirmed loaded; every photo loaded; no panel overflows (measured in headless Chrome after two rounds of tightening).

## Next

The tri-fold is open in the VPS browser: open `https://code.sastx.net/proxy/6080/` and you should see the two brochure sheets on a grey backdrop with the print hint above them. Press Ctrl+P, set Destination to Save as PDF, leave Margins at Default, and the dialog should show no Paper size picker; save. Or take the PDFs from `render/` directly.
