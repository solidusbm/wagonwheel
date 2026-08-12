import nodemailer from "nodemailer";

let transporter;

/* Gmail and most relays reject a From that isn't the authenticated mailbox, so fall back to
   SMTP_USER rather than to a made-up address on a domain that doesn't exist. */
function fromAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || "bookings@wagonwheel.local";
}

/* What the admin panel shows about mail setup. Deliberately reports whether the password is
   present rather than what it is -- nothing here should ever put a credential on the wire. */
export function mailConfigStatus() {
  const host = process.env.SMTP_HOST || null;
  const adminEmail = process.env.ADMIN_EMAIL || null;
  return {
    smtpHost: host,
    smtpPort: Number(process.env.SMTP_PORT ?? 587),
    smtpUser: process.env.SMTP_USER || null,
    hasPassword: Boolean(process.env.SMTP_PASS),
    from: fromAddress(),
    adminEmail,
    ready: Boolean(host && adminEmail),
  };
}

/* Prove the mail setup works without taking a real booking (and a real card charge) to do it.
   Unlike notifyAdminOfBooking this throws, because the whole point is to surface the failure. */
export async function sendTestEmail() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("ADMIN_EMAIL is not set — there is nowhere to send booking alerts.");

  const mailer = getTransporter();
  if (!mailer) throw new Error("SMTP_HOST is not set — the app has no mail server to send through.");

  await mailer.verify(); // connection + credentials, before anything is queued

  const info = await mailer.sendMail({
    from: fromAddress(),
    to: adminEmail,
    subject: "Wagon Wheel — test message",
    text: [
      "This is a test from the Wagon Wheel booking site's admin panel.",
      "",
      "If you are reading this, new bookings will reach this address.",
      `Sent from: ${fromAddress()}`,
      `Server: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT ?? 587}`,
    ].join("\n"),
  });

  return { accepted: info.accepted ?? [], messageId: info.messageId ?? null };
}

function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!process.env.SMTP_HOST) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporter;
}

/* ---------- guest confirmation ----------
   Everything below is stated on the park's own /hours page -- check-in and check-out times, the
   register-at-the-office rule, and the deposit/cancellation terms. Do NOT invent policy here; if
   the park changes its terms, the page and this template have to move together.

   The guest WiFi password is deliberately absent. It is not published anywhere guest-facing and
   must not be added without the park explicitly asking. */
const PARK = {
  name: "Bandera Wagon Wheel RV Park",
  address: "325 Polly Peak Dr, Bandera, TX 78003",
  phone: "(830) 850-0805",
  checkIn: "3:00pm",
  checkOut: "1:00pm",
};

const money = (cents) => `$${(cents / 100).toFixed(2)}`;

/* Dates arrive as plain YYYY-MM-DD with no timezone. Parsing them with `new Date(iso)` gives
   UTC midnight, which formats as the PREVIOUS day anywhere west of Greenwich -- including Texas.
   Build the date explicitly in UTC and format it in UTC so a guest is never told they arrive a
   day before they do. */
function prettyDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return String(iso);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  });
}

export function guestConfirmation(reservation) {
  const r = reservation;
  const nights = r.nights === 1 ? "1 night" : `${r.nights} nights`;
  const subject = `Your reservation at ${PARK.name} - ${r.reservationCode}`;

  const lines = [
    `Hi ${r.guest.name.split(" ")[0]},`,
    ``,
    `You're booked. Here are the details:`,
    ``,
    `  Confirmation code   ${r.reservationCode}`,
    `  Site                ${r.site.name} (${r.site.area})`,
    `  Arriving            ${prettyDate(r.checkIn)}, from ${PARK.checkIn}`,
    `  Leaving             ${prettyDate(r.checkOut)}, by ${PARK.checkOut}`,
    `  Length of stay      ${nights}`,
    `  Guests              ${r.guest.numGuests}`,
    `  Paid                ${money(r.totalCents)}`,
    ``,
    `When you arrive, stop at the office to register before parking. It's just`,
    `inside the entrance gate on your right.`,
    ``,
    `  ${PARK.name}`,
    `  ${PARK.address}`,
    `  ${PARK.phone}`,
    ``,
    `Cancelling: nightly and weekly reservations include a non-refundable`,
    `one-night deposit. Cancel 14 or more days before you arrive and anything`,
    `paid above that deposit is refunded. Cancel inside 14 days and you'll get`,
    `camping credit instead, minus the deposit -- credit is good for a year and`,
    `can't be used on holiday or event weekends.`,
    ``,
    `Quiet hours are 10:00pm to 6:00am. Speed limit is 5mph throughout the park.`,
    ``,
    `Just reply to this email if you need anything before your stay.`,
  ];

  const row = (label, value) =>
    `<tr><td style="padding:5px 16px 5px 0;color:#7a6650;white-space:nowrap;">${escapeHtml(label)}</td>` +
    `<td style="padding:5px 0;color:#2b1d10;font-weight:600;">${escapeHtml(value)}</td></tr>`;

  const html = `<div style="font-family:Georgia,'Times New Roman',serif;font-size:16px;line-height:1.6;color:#2b1d10;max-width:560px;">
  <p>Hi ${escapeHtml(r.guest.name.split(" ")[0])},</p>
  <p>You're booked. Here are the details:</p>
  <table style="border-collapse:collapse;margin:18px 0;font-size:15px;">
    ${row("Confirmation code", r.reservationCode)}
    ${row("Site", `${r.site.name} (${r.site.area})`)}
    ${row("Arriving", `${prettyDate(r.checkIn)}, from ${PARK.checkIn}`)}
    ${row("Leaving", `${prettyDate(r.checkOut)}, by ${PARK.checkOut}`)}
    ${row("Length of stay", nights)}
    ${row("Guests", String(r.guest.numGuests))}
    ${row("Paid", money(r.totalCents))}
  </table>
  <p>When you arrive, stop at the office to register before parking. It's just inside the entrance gate on your right.</p>
  <p style="margin:18px 0;padding:14px 16px;background:#f6ecd8;border-left:3px solid #a9721f;">
    <b>${escapeHtml(PARK.name)}</b><br>
    ${escapeHtml(PARK.address)}<br>
    ${escapeHtml(PARK.phone)}
  </p>
  <p style="font-size:14px;color:#5c5245;">
    <b>Cancelling:</b> nightly and weekly reservations include a non-refundable one-night deposit.
    Cancel 14 or more days before you arrive and anything paid above that deposit is refunded.
    Cancel inside 14 days and you'll get camping credit instead, minus the deposit &mdash; credit is
    good for a year and can't be used on holiday or event weekends.
  </p>
  <p style="font-size:14px;color:#5c5245;">Quiet hours are 10:00pm to 6:00am. Speed limit is 5mph throughout the park.</p>
  <p>Just reply to this email if you need anything before your stay.</p>
</div>`;

  return { subject, text: lines.join("\n"), html };
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* Fire-and-log, exactly like the admin notification: the card has already been charged and the
   reservation already exists, so a mail failure must never turn a successful booking into an
   error the guest sees. */
export async function sendGuestConfirmation(reservation) {
  if (!reservation?.guest?.email) return;
  const mailer = getTransporter();
  const { subject, text, html } = guestConfirmation(reservation);
  if (!mailer) {
    console.log(`[email] SMTP not configured - would have sent to ${reservation.guest.email}:\n${subject}`);
    return;
  }
  try {
    await mailer.sendMail({ from: fromAddress(), to: reservation.guest.email, subject, text, html });
  } catch (err) {
    console.error(`[email] Failed to send guest confirmation for ${reservation.reservationCode}`, err);
  }
}

/* Sends the guest template, filled with an obviously-fake booking, to ADMIN_EMAIL -- so the park
   can see exactly what a guest receives without taking a booking to find out. Throws, so the
   admin panel can show the real SMTP error. */
export async function sendSampleGuestEmail() {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) throw new Error("ADMIN_EMAIL is not set - there is nowhere to send the sample.");
  const mailer = getTransporter();
  if (!mailer) throw new Error("SMTP_HOST is not set - the app has no mail server to send through.");

  const sample = {
    reservationCode: "SAMPLE1",
    site: { name: "Site 1", area: "Front Row" },
    guest: { name: "Sample Guest", email: adminEmail, numGuests: 2 },
    checkIn: "2026-09-14",
    checkOut: "2026-09-17",
    nights: 3,
    totalCents: 13500,
  };
  const { subject, text, html } = guestConfirmation(sample);
  await mailer.verify();
  const info = await mailer.sendMail({
    from: fromAddress(),
    to: adminEmail,
    subject: `[SAMPLE] ${subject}`,
    text: `This is a preview of the email a guest receives. The booking below is not real.\n\n${text}`,
    html: `<p style="font-family:sans-serif;font-size:13px;color:#8a5a0b;background:#f8efdd;padding:10px 14px;">This is a preview of the email a guest receives. The booking below is not real.</p>${html}`,
  });
  return { accepted: info.accepted ?? [], messageId: info.messageId ?? null };
}

// Fire-and-log: a broken mail server should never fail a booking that already charged the card.
export async function notifyAdminOfBooking(reservation) {
  const adminEmail = process.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.log(`[email] ADMIN_EMAIL not set - skipping admin notification for ${reservation.reservationCode}`);
    return;
  }

  const subject = `New booking ${reservation.reservationCode} — ${reservation.site.name}`;
  const text = [
    `Site: ${reservation.site.name} (${reservation.site.area})`,
    `Dates: ${reservation.checkIn} -> ${reservation.checkOut} (${reservation.nights} night${reservation.nights === 1 ? "" : "s"})`,
    `Guest: ${reservation.guest.name} <${reservation.guest.email}>${reservation.guest.phone ? " · " + reservation.guest.phone : ""}`,
    `Guests: ${reservation.guest.numGuests}`,
    `Total paid: $${(reservation.totalCents / 100).toFixed(2)}`,
    `Confirmation code: ${reservation.reservationCode}`,
  ].join("\n");

  const mailer = getTransporter();
  if (!mailer) {
    console.log(`[email] SMTP not configured - would have sent to ${adminEmail}:\n${subject}\n${text}`);
    return;
  }

  try {
    await mailer.sendMail({
      from: fromAddress(),
      to: adminEmail,
      subject,
      text,
    });
  } catch (err) {
    console.error("[email] Failed to send admin notification", err);
  }
}
