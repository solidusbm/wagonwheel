const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function nightsBetween(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  return Math.round((end - start) / MS_PER_DAY);
}

// Full weeks bill at the weekly rate, any remaining nights bill at the nightly rate --
// e.g. a 10-night stay is 1 week + 3 nights. Falls back to pure nightly pricing when no
// weekly rate is configured for the site.
export function quote({ pricePerNightCents, pricePerWeekCents, pricePerMonthCents, checkIn, checkOut }) {
  const nights = nightsBetween(checkIn, checkOut);
  // The park charges no booking fee -- confirmed 2026-08-11 after the first live payment came
  // through at the bare nightly rate. Defaulting to 0 rather than 500 means an environment that
  // loses BOOKING_FEE_CENTS quietly matches the park's actual policy instead of quietly
  // overcharging every guest $5.
  const bookingFeeCents = Number(process.env.BOOKING_FEE_CENTS ?? 0);

  const stack = (n) => {
    if (n <= 0) return 0;
    if (!pricePerWeekCents) return n * pricePerNightCents;
    const weeks = Math.floor(n / 7);
    return weeks * pricePerWeekCents + (n % 7) * pricePerNightCents;
  };

  // The monthly rate is a CAP APPLIED PER MONTH, not a one-off ceiling on the whole stay:
  // whole months bill at the monthly rate, and whatever is left over bills the normal
  // weekly/nightly way but never for more than one more month. So 30 nights and 45 nights both
  // cost at most one month plus the leftover, and 60 nights costs two months -- rather than a
  // year costing the same as a fortnight, which a single flat ceiling would produce.
  const MONTH_NIGHTS = 30;
  let subtotalCents;
  let monthlyRateApplied = false;
  if (pricePerMonthCents) {
    const months = Math.floor(nights / MONTH_NIGHTS);
    const remainder = nights % MONTH_NIGHTS;
    const remainderStacked = stack(remainder);
    const remainderCharged = Math.min(remainderStacked, pricePerMonthCents);
    subtotalCents = months * pricePerMonthCents + remainderCharged;
    monthlyRateApplied = months > 0 || remainderCharged < remainderStacked;
  } else {
    subtotalCents = stack(nights);
  }

  const totalCents = subtotalCents + bookingFeeCents;
  return { nights, subtotalCents, bookingFeeCents, totalCents, monthlyRateApplied };
}

/* ---------- cancellation ----------
   Set by the park 2026-08-11, replacing the earlier deposit / 14-day / camping-credit terms.
   A booking that was charged at the monthly rate -- including a shorter stay that hit the cap --
   carries a flat $100 service fee. Everything else carries 11.11% of what was charged. The rest
   is refunded; the fee never exceeds what was paid. */
export const MONTHLY_CANCELLATION_FEE_CENTS = 10000;
export const CANCELLATION_FEE_RATE = 0.1111;

export function cancellationQuote({ totalCents, monthlyRateApplied }) {
  const paid = Math.max(0, Math.round(totalCents ?? 0));
  const rawFee = monthlyRateApplied
    ? MONTHLY_CANCELLATION_FEE_CENTS
    : Math.round(paid * CANCELLATION_FEE_RATE);
  const feeCents = Math.min(rawFee, paid);
  return {
    feeCents,
    refundCents: paid - feeCents,
    basis: monthlyRateApplied ? "monthly" : "standard",
  };
}
