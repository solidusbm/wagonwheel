const statusEl = document.getElementById("push-status");
const toggleBtn = document.getElementById("push-toggle-btn");
const iosHint = document.getElementById("ios-hint");

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

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

async function refreshStatus() {
  const subscription = await getSubscription();
  if (subscription) {
    statusEl.textContent = "Push notifications are ON for this device.";
    statusEl.classList.add("on");
    toggleBtn.textContent = "Disable on this device";
    toggleBtn.hidden = false;
  } else {
    statusEl.textContent = "Push notifications are OFF for this device.";
    statusEl.classList.remove("on");
    toggleBtn.textContent = "Enable on this device";
    toggleBtn.hidden = false;
  }
}

async function enable() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    statusEl.textContent = "Notification permission was denied in the browser.";
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

(async function init() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    statusEl.textContent = "This browser doesn't support push notifications.";
    return;
  }

  if (isIos && !isStandalone) {
    statusEl.textContent = "Not available in Safari yet — install as an app first (see below).";
    iosHint.hidden = false;
    return;
  }

  try {
    /* Absolute, not "sw.js". The admin is served at both /admin and /admin/ (express.static
       hands back index.html either way), and a relative URL resolves against the *page*: from
       /admin it asks for /sw.js, which is a 404 and a root scope. Pinning the scope matters for
       the same reason -- navigator.serviceWorker.ready below only resolves for a registration
       whose scope covers the current page, so the redirect to /admin/ in server/index.js is
       load-bearing here. */
    await navigator.serviceWorker.register("/admin/sw.js", { scope: "/admin/" });
    await refreshStatus();
  } catch (err) {
    statusEl.textContent = "Couldn't set up push notifications: " + err.message;
  }
})();
