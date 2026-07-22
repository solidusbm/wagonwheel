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

The root `index.html` is a small comparison hub linking to each design variant, kept live side by side rather than replacing one another:

- **`v1/`** — Dark Cowboy: dark parchment-on-charcoal, night-sky hero. The original design.
- **`v2/`** — Light Rustic: same HTML/content, flipped to a warm cream/tan daytime palette and sunlit hero.

Both variants share identical markup and copy — only `css/style.css` (and the hero illustration's CSS-variable colors) differ — so it's a clean visual A/B, not a content diff. To add another variant: copy a `vN/` folder, redesign its `css/style.css`, add a card to the root `index.html`.

## Stack

Just static files — no build step, no dependencies, no server:
- `index.html` (comparison hub)
- `v1/index.html`, `v1/css/style.css`
- `v2/index.html`, `v2/css/style.css`

## Local preview

Open any `index.html` directly in a browser, or serve the whole folder with any static file server, e.g.:

```bash
npx serve .
```

## Deploying

Any static host works — no backend, no database, no environment variables. Options include GitHub Pages, Cloudflare Pages, Netlify, or Render's (actual) Static Site tier — unlike the full version's Render *Web Service*, a static site has no sleep/cold-start behavior and no database to expire.

## Relationship to the full version

The full custom-built app (real-time availability, its own PostgreSQL-backed double-booking prevention, Square payments, `/admin` panel) lives on branch `claude/rv-booking-project-6pigax` and is deployed separately (Render + Fly.io). This branch does not track or merge with that one — they're two independent approaches kept side by side so both can be demoed.
