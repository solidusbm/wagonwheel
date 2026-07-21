import nodemailer from "nodemailer";

let transporter;

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
      from: process.env.SMTP_FROM || "bookings@wagonwheel.local",
      to: adminEmail,
      subject,
      text,
    });
  } catch (err) {
    console.error("[email] Failed to send admin notification", err);
  }
}
