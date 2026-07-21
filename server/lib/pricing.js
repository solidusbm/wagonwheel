const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function nightsBetween(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  return Math.round((end - start) / MS_PER_DAY);
}

export function quote({ pricePerNightCents, checkIn, checkOut }) {
  const nights = nightsBetween(checkIn, checkOut);
  const bookingFeeCents = Number(process.env.BOOKING_FEE_CENTS ?? 500);
  const subtotalCents = nights * pricePerNightCents;
  const totalCents = subtotalCents + bookingFeeCents;
  return { nights, subtotalCents, bookingFeeCents, totalCents };
}
