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
