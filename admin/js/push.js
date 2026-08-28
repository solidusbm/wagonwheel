const statusEl = document.getElementById("push-status");
const alertsEl = document.getElementById("push-alerts");
const devicesEl = document.getElementById("push-devices");
const toggleBtn = document.getElementById("push-toggle-btn");
const testBtn = document.getElementById("push-test-btn");
const testStatus = document.getElementById("push-test-status");
const iosHint = document.getElementById("ios-hint");
const iosInstalledHint = document.getElementById("ios-installed-hint");
const androidHint = document.getElementById("android-hint");

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
const isAndroid = /Android/.test(navigator.userAgent);

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getSubscription() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
  const registration = await navigator.serviceWorker.ready;
  return registration.pushManager.getSubscription();
}

/* The toggle above can only ever report on the browser it is running in. This is the park-wide
   count, which is the number that answers "did the office's phone actually get signed up?" */
async function refreshDeviceCount() {
  try {
    const res = await fetch("/api/admin/push/status");
    if (!res.ok) return;
    const { configured, devices } = await res.json();
    if (!configured) {
      devicesEl.textContent = "Push is not configured on the server (no VAPID keys set).";
      return;
    }
    devicesEl.textContent =
      devices === 0
        ? "No devices signed up yet — nobody is being alerted."
        : `${devices} device${devices === 1 ? "" : "s"} signed up across the park.`;
  } catch {
    // A missing count is cosmetic; don't let it blank out the panel.
  }
}

/* Bookings still waiting on a human. Top of the panel and styled loudly on purpose: a notification
   can be swiped away, and once it has been, this is the only thing left that still knows the
   office never actually dealt with the booking. */
async function refreshAlerts() {
  try {
    const res = await fetch("/api/admin/push/alerts");
    if (!res.ok) return;
    const { alerts, maxAttempts } = await res.json();

    alertsEl.replaceChildren();
    for (const alert of alerts) alertsEl.append(buildAlert(alert, maxAttempts));
  } catch {
    // Cosmetic. The notifications themselves are the channel that matters.
  }
}

function buildAlert(alert, maxAttempts) {
  const wrap = document.createElement("div");
  wrap.className = "push-alert";

  const title = document.createElement("strong");
  title.textContent = `Not acknowledged — booking ${alert.reservation_code}`;

  /* textContent rather than innerHTML, here and below: alert.body carries the guest's own name,
     straight from the booking form and never escaped on the way in. */
  const body = document.createElement("div");
  body.className = "push-alert-body";
  body.textContent = alert.body;

  const meta = document.createElement("div");
  meta.className = "sub";
  meta.textContent =
    alert.attempts >= maxAttempts
      ? `Alerted ${alert.attempts} times with no response, and has stopped repeating.`
      : `Alert ${alert.attempts} of ${maxAttempts} — repeating every 5 minutes until acknowledged.`;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "btn btn-primary";
  btn.textContent = "Acknowledge";
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      await fetch("/api/alerts/ack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: alert.ack_token, via: "admin-panel" }),
      });
    } catch {
      // Leave it pending. A failed acknowledgement should keep alerting, not quietly stop.
      btn.disabled = false;
    }
    await refreshAlerts();
  });

  wrap.append(title, body, meta, btn);
  return wrap;
}

/* Outside init() and its early returns on purpose. A pending alert is worth showing on a desktop
   that can't do push at all, or an iPhone that hasn't been installed to the Home Screen yet --
   those are precisely the machines where the notification never arrived in the first place. */
refreshAlerts();
setInterval(refreshAlerts, 30 * 1000);

async function refreshStatus() {
  const subscription = await getSubscription();
  if (subscription) {
    statusEl.textContent = "Push notifications are ON for this device.";
    statusEl.classList.add("on");
    toggleBtn.textContent = "Disable on this device";
    /* Android delivers the push but decides for itself whether it makes a sound or a banner, and
       that is set per site in the phone's own settings. Surface the steps once it is actually on,
       because that is the point at which "it arrived but I never saw it" starts happening. */
    androidHint.hidden = !isAndroid;
  } else {
    statusEl.textContent = "Push notifications are OFF for this device.";
    statusEl.classList.remove("on");
    toggleBtn.textContent = "Enable on this device";
    androidHint.hidden = true;
  }
  toggleBtn.hidden = false;
  await refreshDeviceCount();
}

async function enable() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    statusEl.textContent =
      permission === "denied"
        ? isIos
          ? "iOS has notifications blocked for this app. Delete the Home Screen icon, add it again, and choose Allow."
          : "Notifications are blocked for this site. Re-allow them in the browser's site settings (the padlock in the address bar), then try again."
        : "Notification permission wasn't granted.";
    return;
  }

  const keyRes = await fetch("/api/admin/push/vapid-public-key");
  const { publicKey } = await keyRes.json();
  if (!publicKey) {
    statusEl.textContent = "Push isn't configured on the server yet (missing VAPID keys).";
    return;
  }

  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  await fetch("/api/admin/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

  await refreshStatus();
}

async function disable() {
  const subscription = await getSubscription();
  if (!subscription) return;
  const endpoint = subscription.endpoint;
  await subscription.unsubscribe();
  await fetch("/api/admin/push/unsubscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  await refreshStatus();
}

toggleBtn.addEventListener("click", async () => {
  toggleBtn.disabled = true;
  const subscription = await getSubscription();
  if (subscription) {
    await disable();
  } else {
    await enable();
  }
  toggleBtn.disabled = false;
});

/* Deliberately fires at EVERY signed-up device, not just this one. The question being answered is
   "will the office's phone light up when a booking lands", and that phone is usually not the one
   holding the button. */
testBtn.addEventListener("click", async () => {
  testBtn.disabled = true;
  testStatus.textContent = "Sending to every signed-up device…";
  try {
    const res = await fetch("/api/admin/push/test", { method: "POST" });
    const data = await res.json();
    if (!data.ok) {
      testStatus.textContent = "Failed: " + data.error;
    } else {
      const parts = [`Sent to ${data.sent} of ${data.total} device${data.total === 1 ? "" : "s"}.`];
      if (data.expired) parts.push(`${data.expired} had expired and were removed.`);
      if (data.errors?.length) parts.push("Errors: " + data.errors.join("; "));
      parts.push("Check each phone — including the lock screen.");
      testStatus.textContent = parts.join(" ");
    }
  } catch (err) {
    testStatus.textContent = "Failed: " + err.message;
  } finally {
    testBtn.disabled = false;
    await refreshDeviceCount();
  }
});

(async function init() {
  /* An iPhone in Safari has no PushManager at all until the site runs from the Home Screen, so it
     lands in the "unsupported" branch rather than the iOS one. Both need the install steps --
     "this browser doesn't support notifications" reads as a dead end when it is a one-time setup. */
  const needsInstall = isIos && !isStandalone;
  const unsupported = !("serviceWorker" in navigator) || !("PushManager" in window);

  if (needsInstall || unsupported) {
    statusEl.textContent = needsInstall
      ? "Not available in Safari yet — install as an app first (see below)."
      : "This browser doesn't support push notifications.";
    iosHint.hidden = !needsInstall;
    toggleBtn.hidden = true;
    await refreshDeviceCount();
    return;
  }

  if (isIos && isStandalone) iosInstalledHint.hidden = false;

  try {
    /* Absolute, not "sw.js". The admin is served at both /admin and /admin/ (express.static
       hands back index.html either way), and a relative URL resolves against the *page*: from
       /admin it asks for /sw.js, which is a 404 and a root scope. Pinning the scope matters for
       the same reason -- navigator.serviceWorker.ready below only resolves for a registration
       whose scope covers the current page, so the redirect to /admin/ in server/index.js is
       load-bearing here. */
    const registration = await navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" });
    /* Pull a changed sw.js now rather than at some later navigation. Paired with skipWaiting() in
       the worker, an updated notification format takes effect on this visit instead of whenever
       every admin tab on the phone next happens to be closed. */
    registration.update().catch(() => {});
    await refreshStatus();
  } catch (err) {
    statusEl.textContent = "Couldn't set up push notifications: " + err.message;
  }
})();
