const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MONTH_NIGHTS = 30;

const money = (cents) => `$${(cents / 100).toFixed(2)}`;
const line = (count, unit, unitCents) => ({
  label: `${money(unitCents)} × ${count} ${unit}${count === 1 ? "" : "s"}`,
  amountCents: count * unitCents,
});

export function nightsBetween(checkIn, checkOut) {
  const start = new Date(`${checkIn}T00:00:00Z`);
  const end = new Date(`${checkOut}T00:00:00Z`);
  return Math.round((end - start) / MS_PER_DAY);
}

// A site is bookable online only if it sells at least one term. Every route that quotes a price
// checks this first, so an unrateable site is refused with a sentence a guest can understand
// rather than reaching quote() and throwing.
export function isPriceable({ pricePerNightCents, pricePerWeekCents, pricePerMonthCents }) {
  return Boolean(pricePerNightCents || pricePerWeekCents || pricePerMonthCents);
}

/* A site does not have to offer every term. Site 1 is rented by the month only: its nightly and
 * weekly rates are N/A, and a two-week stay there is still a month's rent -- which is how a
 * monthly-only site is actually let, not a rounding bug. So the engine bills a stay with
 * whatever rates the site HAS, rounding up to the smallest term it sells.
 *
 * `lines` is the breakdown the guest is shown. It comes back from here rather than being
 * rebuilt in the browser, because the two used to disagree: the order summary stacked weeks and
 * nights of its own accord, knew nothing about the monthly cap, and added a $5 booking fee the
 * park stopped charging -- so the figure a guest agreed to was not the figure their card was
 * charged. The server is the only place that prices a stay now.
 */
export function quote({ pricePerNightCents, pricePerWeekCents, pricePerMonthCents, checkIn, checkOut }) {
  const nights = nightsBetween(checkIn, checkOut);
  // The park charges no booking fee -- confirmed 2026-08-11 after the first live payment came
  // through at the bare nightly rate. Defaulting to 0 rather than 500 means an environment that
  // loses BOOKING_FEE_CENTS quietly matches the park's actual policy instead of quietly
  // overcharging every guest $5.
  const bookingFeeCents = Number(process.env.BOOKING_FEE_CENTS ?? 0);

  // A rate of 0 is treated exactly like N/A -- neither is a term the park sells.
  const night = pricePerNightCents || null;
  const week = pricePerWeekCents || null;
  const month = pricePerMonthCents || null;
  if (!night && !week && !month) {
    throw new Error("Site has no rates configured, so a stay cannot be priced");
  }

  // Prices n nights using the sub-month rates alone, or returns null when the site sells no term
  // shorter than a month. That null is what makes the monthly-only case fall out of the branch
  // below instead of needing one of its own.
  const belowMonth = (n) => {
    if (n <= 0) return { cents: 0, lines: [] };
    if (week && night) {
      const weeks = Math.floor(n / 7);
      const spare = n % 7;
      return {
        cents: weeks * week + spare * night,
        lines: [...(weeks ? [line(weeks, "week", week)] : []), ...(spare ? [line(spare, "night", night)] : [])],
      };
    }
    // Only one sub-month rate, so whole units, rounded up: part of a week costs a week at a
    // weekly-only site, the same way part of a month costs a month at a monthly-only one.
    if (week) {
      const weeks = Math.ceil(n / 7);
      return { cents: weeks * week, lines: [line(weeks, "week", week)] };
    }
    if (night) return { cents: n * night, lines: [line(n, "night", night)] };
    return null;
  };

  let subtotalCents;
  let monthlyRateApplied;
  let lines;

  if (month) {
    // The monthly figure is a CAP APPLIED PER MONTH, not a one-off ceiling on the whole stay:
    // whole months bill at the monthly rate, and whatever is left over bills the normal
    // weekly/nightly way but never for more than one more month. So 30 nights and 45 nights both
    // cost at most one month plus the leftover, and 60 nights costs two months -- rather than a
    // year costing the same as a fortnight, which a single flat ceiling would produce.
    const months = Math.floor(nights / MONTH_NIGHTS);
    const remainder = nights % MONTH_NIGHTS;
    const rest = belowMonth(remainder);
    // The remainder bills the normal way unless that costs more than simply calling it another
    // month -- or unless the site sells nothing shorter, in which case it *is* another month.
    const remainderIsAMonth = remainder > 0 && (rest === null || rest.cents > month);
    const monthsCharged = months + (remainderIsAMonth ? 1 : 0);

    subtotalCents = monthsCharged * month + (remainderIsAMonth ? 0 : rest.cents);
    monthlyRateApplied = monthsCharged > 0;
    lines = [
      ...(monthsCharged ? [line(monthsCharged, "month", month)] : []),
      ...(remainderIsAMonth ? [] : rest.lines),
    ];
  } else {
    const rest = belowMonth(nights);
    subtotalCents = rest.cents;
    monthlyRateApplied = false;
    lines = rest.lines;
  }

  const totalCents = subtotalCents + bookingFeeCents;
  return { nights, lines, subtotalCents, bookingFeeCents, totalCents, monthlyRateApplied };
}

/* ---------- cancellation ----------
   Set by the park 2026-08-11, replacing the earlier deposit / 14-day / camping-credit terms.
   A booking that was charged at the monthly rate -- including a shorter stay that hit the cap,
   and any stay at a monthly-only site -- carries a flat $100 service fee. Everything else
   carries 11.11% of what was charged. The rest is refunded; the fee never exceeds what was paid. */
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
