// Minimal iCalendar (RFC 5545) generator -- just enough to export site
// availability for import into RoverPass/Hipcamp or any other calendar-based
// sync. No external library needed for a feed this simple.

function icsDate(dateStr) {
  // dateStr is a plain "YYYY-MM-DD" -- render as an all-day VALUE=DATE, not a timestamp.
  return dateStr.replaceAll("-", "");
}

function escapeText(text) {
  return String(text).replaceAll("\\", "\\\\").replaceAll(",", "\\,").replaceAll(";", "\\;").replaceAll("\n", "\\n");
}

function foldLine(line) {
  // RFC 5545 requires folding lines longer than 75 octets; not strictly needed
  // for our short lines, but cheap enough to do correctly.
  if (line.length <= 75) return line;
  let result = line.slice(0, 75);
  let rest = line.slice(75);
  while (rest.length > 0) {
    result += "\r\n " + rest.slice(0, 74);
    rest = rest.slice(74);
  }
  return result;
}

// bookings: [{ code, checkIn, checkOut }] -- deliberately excludes guest PII;
// this feed's only job is to mark a site's dates as unavailable elsewhere.
export function generateSiteIcs({ siteName, bookings }) {
  const now = new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Wagon Wheel RV Park//Direct Booking Sync//EN", "CALSCALE:GREGORIAN"];

  for (const b of bookings) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${b.code}@wagonwheelrvpark`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${icsDate(b.checkIn)}`,
      `DTEND;VALUE=DATE:${icsDate(b.checkOut)}`,
      `SUMMARY:${escapeText(`Reserved - ${siteName} (direct booking)`)}`,
      "TRANSP:OPAQUE",
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
