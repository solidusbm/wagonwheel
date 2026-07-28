const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function nightsBetween(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  return Math.round((end - start) / MS_PER_DAY);
}

// Full weeks bill at the weekly rate, any remaining nights bill at the nightly rate --
// e.g. a 10-night stay is 1 week + 3 nights. Falls back to pure nightly pricing when no
// weekly rate is configured for the site.
export function quote({ pricePerNightCents, pricePerWeekCents, checkIn, checkOut }) {
  const nights = nightsBetween(checkIn, checkOut);
  const bookingFeeCents = Number(process.env.BOOKING_FEE_CENTS ?? 500);

  let subtotalCents;
  if (pricePerWeekCents) {
    const weeks = Math.floor(nights / 7);
    const remainderNights = nights % 7;
    subtotalCents = weeks * pricePerWeekCents + remainderNights * pricePerNightCents;
  } else {
    subtotalCents = nights * pricePerNightCents;
  }

  const totalCents = subtotalCents + bookingFeeCents;
  return { nights, subtotalCents, bookingFeeCents, totalCents };
}
