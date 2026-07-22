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

Every one of the twelve numbered variants now also has two alternate takes on its theme, nested under its card on the root `index.html` (an "Alternates" chip row) rather than listed as top-level variants:

- **v1 (Dark Cowboy):** `v1b` Midnight Rodeo — red/blue neon marquee frame, arena-signage hero. `v1c` Campfire Ember — dark charcoal with a warm ember-glow vignette hero.
- **v2 (Light Rustic):** `v2b` Sunday Porch — pale sage/cream, screen-door lattice texture, wicker frame. `v2c` Wildflower Meadow — dusty pink/lavender, botanical line art.
- **v3 (Minimalist Modern):** `v3b` Mono Ledger — pure black/white, zero color accent, numbered ledger rows. `v3c` Soft Neutral — warm gray/beige, single dusty-blue accent, rounded cards.
- **v4 (Brutalist):** `v4b` Concrete Block — grayscale concrete texture, single red stamp accent. `v4c` Zine Punk — photocopy/torn-paper collage, hot pink accent.
- **v5 (National Park Poster):** `v5b` Canyon Postcard — terracotta/turquoise desert palette, postcard-and-stamp hero framing. `v5c` Ranger Badge — dark forest-green letterpress feel, circular badge emblem.
- **v6 (Neon Saloon):** `v6b` Laser Grid Rodeo — green/amber Tron-style grid, terminal aesthetic. `v6c` Neon Cactus — magenta sunset gradient, glowing cyan cactus silhouettes.
- **v7 (Boutique Lodge):** `v7b` Cabin Luxury — walnut/terracotta/brass, split-frame hero. `v7c` Modern Ivory — ivory/sage, ultra-airy hairline minimalism.
- **v8 (Retro '70s Americana):** `v8b` Googie Diner — teal/coral mid-century motel signage, boomerang shapes. `v8c` Woodgrain Sienna — muted sienna/olive, rainbow-arch hero.
- **v9 (Editorial Magazine):** `v9b` Travel Journal — warm cream, handwriting captions, polaroid gallery. `v9c` Business Weekly — cool navy/gray, spreadsheet-style data tables.
- **v10 (Trail Map / Topographic):** `v10b` USGS Survey — technical cartography, coordinate grid, compass rose. `v10c` Alpine Gear Co. — pine/orange, bold outdoor-brand catalog look.
- **v11 (Glassmorphism):** `v11b` Aurora Glass — cool green/blue aurora gradient, frosted white glass. `v11c` Sunset Glass — warm coral/orange/pink gradient glass.
- **v12 (Vintage Newspaper):** `v12b` Wanted Poster — aged parchment, torn edges, bold wood-type headline. `v12c` Telegram Dispatch — Western Union telegram look, typewriter ALL-CAPS.

Same rule applies throughout: identical page content, different execution. Folder naming is `vN` + a letter (`b`, `c`, …) for each additional take on that variant's theme.

## Stack

Just static files — no build step, no dependencies, no server:
- `index.html` (comparison hub)
- `v1/` … `v12/`, each with its own `index.html` and `css/style.css`
- `v1b/`, `v1c/`, `v2b/`, `v2c/`, `v3b/`, `v3c/`, `v4b/`, `v4c/`, `v5b/`, `v5c/`, `v6b/`, `v6c/`, `v7b/`, `v7c/`, `v8b/`, `v8c/`, `v9b/`, `v9c/`, `v10b/`, `v10c/`, `v11b/`, `v11c/`, `v12b/`, `v12c/` — two alternate takes per numbered variant, 24 pages in total

## Local preview

Open any `index.html` directly in a browser, or serve the whole folder with any static file server, e.g.:

```bash
npx serve .
```

## Deploying

Any static host works — no backend, no database, no environment variables. Options include GitHub Pages, Cloudflare Pages, Netlify, or Render's (actual) Static Site tier — unlike the full version's Render *Web Service*, a static site has no sleep/cold-start behavior and no database to expire.

## Relationship to the full version

The full custom-built app (real-time availability, its own PostgreSQL-backed double-booking prevention, Square payments, `/admin` panel) lives on branch `claude/rv-booking-project-6pigax` and is deployed separately (Render + Fly.io). This branch does not track or merge with that one — they're two independent approaches kept side by side so both can be demoed.
