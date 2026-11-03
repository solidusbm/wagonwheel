# docs

Reference material that belongs with the project but isn't served by the app.

## `google-review-qr.png` — the park's Google review QR code

Scans to the park's "leave a review" page on Google:

    https://g.page/r/CdUaZY8L9PjZEBM/review

That link and the QR both come from the Business Profile itself (Google Search → the park's
profile → **Ask for reviews**), saved 2026-08-17. It is the same link the automated review-request
email uses, so a guest reaches the identical page whether they scan a card at the office or click
the email two days after checking out.

**It is for physical use** — the office counter, a card in the welcome packet, a sticker by the
door. Nothing on the website should show it: anyone already on the site can be given the link.

### Two things to know before printing it

1. **It is 132 × 132 px**, which is what Google's own page serves. That is fine on a screen and
   marginal in print — under half an inch at 300 dpi. Blowing it up will look blocky. For anything
   printed, regenerate at the size you need from the URL above rather than upscaling this file.
2. **Scan it once before it goes to a printer.** It has not been decoded and checked here; it is
   simply the file Google produced.

### The rules that go with asking for reviews

The same two that govern the automated email (`server/lib/reviewRequest.js`), and they apply to a
card on the counter just as much:

- **Never offer anything in exchange for a review.** No discount, no free night, no prize draw.
  Google prohibits it and will remove reviews it catches.
- **Never show it only to guests you think are happy.** Handing the card to some guests and not
  others is review gating, which is against Google's policy for the same reason: it manufactures a
  rating rather than reflecting one.

## `facebook-review-qr.png` — the park's Facebook review QR code

Scans to the park's Reviews tab on Facebook:

    https://www.facebook.com/61558321880729/reviews/

Built from the numeric page ID on the park's Facebook Page (`facebook.com/people/Bandera-Wagon-
Wheel-RV-Park/61558321880729/`) — the manager account that provided it doesn't have access to a
direct "write a review" composer link the way a full admin would, so `.../reviews/` off the page's
numeric ID is the closest deep link available. Verified 2026-08-18 by loading it in a browser: it
lands directly on the page's Reviews section (confirmed against the "No reviews" empty state at the
time), not just the page's timeline.

**It is for physical use**, same as the Google QR above — not shown anywhere on the website.

### This one is incentivized on purpose — Google's twin is not

`admin/review-flyer.html` (the resident review flyer) offers **$10 off per person for a Facebook
review, and asks for a Google review with nothing attached.** That split was a deliberate decision
made 2026-08-18, not an inconsistency: Google explicitly prohibits incentivized reviews and removes
ones it catches (see the two rules above, which still apply in full to the Google side of that
flyer). Facebook does not carry the same blanket prohibition, and the park's owner chose to accept
that risk specifically for Facebook after being told about it. If this flyer is ever revised, keep
that asymmetry — don't "simplify" it into one offer covering both platforms.
