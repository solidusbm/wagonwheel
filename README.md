# Wagon Wheel RV Park (static)

Marketing + booking-entry site for **Bandera Wagon Wheel RV Park** (325 Polly Peak Dr, Bandera, TX 78003).

This is the **static** variant of this site: plain HTML/CSS, no server, no database, no payment integration of its own. It exists on the `static-site` branch alongside the full custom-built version (Express + PostgreSQL + Square, live on `claude/rv-booking-project-6pigax`) as an alternative that trades a custom booking flow for effectively free, zero-maintenance hosting.

## What's here vs. what's not

- **Real:** address, phone, office hours, hookup type (30/50 amp, full hook-up), pet-friendly.
- **Placeholder, needs your input:** the 12 sites (names, layout, nightly rates) — same caveat as the full version, nobody publishes the actual list.
- **Booking is fully outsourced.** Instead of a custom database and payment flow, this page has two placeholder booking cards:
  - **Book direct**, meant for a [RoverPass](https://www.roverpass.com/) embedded widget (~$99/mo for a small park, or pay-per-reservation above ~28 bookings/month — see their [pricing](https://software.roverpass.com/pricing))
  - **Book via Hipcamp**, meant for a Hipcamp ["Book on Hipcamp" button](https://support.hipcamp.com/hc/en-us/articles/360024823212-How-can-I-add-a-Book-on-Hipcamp-button-to-my-website) (free to list, 15% commission, 12.5% if PMS-integrated)
  - RoverPass has a native, no-extra-cost integration with Hipcamp that syncs availability both ways and blocks double-booking between the two channels — so running both simultaneously is a supported setup, not something to build yourself.
- **No accounts exist yet for either service** — both booking cards are visibly marked "Placeholder" and link to `#`. Setting them up is two separate, independent steps:
  1. Create a RoverPass account → replace the `.widget-placeholder` block for "Book direct" in `index.html` with their real embed code.
  2. Create a Hipcamp listing → replace the `.widget-placeholder` block for "Book via Hipcamp" with their real button code/link.

## Style/layout variants

The root `index.html` is a small comparison hub linking to each design variant, kept live side by side rather than replacing one another. All twelve share the same content (address, amenities, nearby spots, booking copy) — only layout, typography, and styling differ:

- **`v1/`** — Dark Cowboy: dark parchment-on-charcoal, night-sky hero. The original design.
- **`v2/`** — Light Rustic: same HTML/content, flipped to a warm cream/tan daytime palette and sunlit hero.
- **`v3/`** — Minimalist Modern: off-white/black, Inter type, hairline grids, generous whitespace.
- **`v4/`** — Brutalist: raw borders, monospace type, no rounded corners, black/cream/acid-yellow.
- **`v5/`** — National Park Poster: WPA travel-poster flats, Bebas Neue display type, screen-printed mountains.
- **`v6/`** — Neon Saloon: synthwave-western mashup, glowing pink/cyan on deep violet, grid horizon.
- **`v7/`** — Boutique Lodge: black/cream/gold, Playfair Display italics, thin rules, quiet luxury restraint.
- **`v8/`** — Retro '70s Americana: sunburst hero, chunky slab type, rounded panels in burnt orange/avocado/mustard.
- **`v9/`** — Editorial Magazine: newsroom masthead, drop caps, pull quotes, asymmetric grid.
- **`v10/`** — Trail Map / Topographic: olive/khaki outdoors palette, contour-line texture, patch-style badges.
- **`v11/`** — Glassmorphism: frosted-glass cards over a violet/teal gradient glow, dark and modern.
- **`v12/`** — Vintage Newspaper: sepia broadsheet, gazette masthead, drop caps, typewriter accents.

`v1`/`v2` share identical markup, differing only in `css/style.css`. `v3`–`v12` vary layout structure as well as styling, for real visual range rather than palette swaps alone. To add another variant: copy a `vN/` folder, redesign its markup/`css/style.css`, add a card to the root `index.html`.

### Alternate takes

Four of the twelve — v5, v7, v8, and v10 — also have alternate takes on the same theme, nested under their card on the root `index.html` rather than listed as top-level variants:

- **`v5b/`** — Canyon Postcard: terracotta/turquoise desert palette, postcard-and-stamp hero framing.
- **`v5c/`** — Ranger Badge: dark forest-green letterpress feel, centered circular ranger-badge emblem.
- **`v7b/`** — Cabin Luxury: walnut/terracotta/brass, split hero with a woodgrain-striped frame panel.
- **`v7c/`** — Modern Ivory: ivory/sage, ultra-thin hairline rules, spa-boutique airiness.
- **`v8b/`** — Googie Diner: teal/coral mid-century motel signage, boomerang shapes, angled hero.
- **`v8c/`** — Woodgrain Sienna: muted sienna/olive, concentric rainbow-arch hero, hand-lettered accents.
- **`v10b/`** — USGS Survey: technical cartography look, coordinate grid overlay, compass rose, monospace labels.
- **`v10c/`** — Alpine Gear Co.: pine green/burnt orange, bold condensed type, outdoor-gear catalog branding.

Same rule applies: identical page content, different execution. Folder naming is `vN` + a letter (`b`, `c`, …) for each additional take on that variant's theme.

## Stack

Just static files — no build step, no dependencies, no server:
- `index.html` (comparison hub)
- `v1/` … `v12/`, each with its own `index.html` and `css/style.css`
- `v5b/`, `v5c/`, `v7b/`, `v7c/`, `v8b/`, `v8c/`, `v10b/`, `v10c/` — alternate takes on v5/v7/v8/v10

## Local preview

Open any `index.html` directly in a browser, or serve the whole folder with any static file server, e.g.:

```bash
npx serve .
```

## Deploying

Any static host works — no backend, no database, no environment variables. Options include GitHub Pages, Cloudflare Pages, Netlify, or Render's (actual) Static Site tier — unlike the full version's Render *Web Service*, a static site has no sleep/cold-start behavior and no database to expire.

## Relationship to the full version

The full custom-built app (real-time availability, its own PostgreSQL-backed double-booking prevention, Square payments, `/admin` panel) lives on branch `claude/rv-booking-project-6pigax` and is deployed separately (Render + Fly.io). This branch does not track or merge with that one — they're two independent approaches kept side by side so both can be demoed.
