/* Notification options here are the difference between an alert the office actually sees and one
   that lands silently in the shade. The ones that carry weight on a phone:
     vibrate  - without it Android can render the notification without buzzing at all
     tag      - the reservation code, so a duplicate push for one booking replaces rather than
                stacks, while two different bookings stay as two separate notifications
     renotify - re-alert (sound/buzz) when a tag is reused instead of swapping it in silently
     requireInteraction - stays up until it's dealt with. Honoured on desktop Chrome/Edge;
                Android ignores it, which is fine -- it costs nothing there.
   Note that none of this can raise the Android *channel* importance. If the notification arrives
   without a heads-up banner, that's set per-site in Android Settings, not from here. */
/* A service worker normally installs and then WAITS until every tab under its scope is closed
   before it replaces the running one -- and the old worker is the one that keeps handling pushes
   meanwhile. On a phone the admin is rarely "closed" in that sense, so without these two the
   notification changes above could sit unused indefinitely. There is no offline cache here to
   version, so activating early is safe. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = { title: "New booking", body: "A reservation was confirmed.", url: "/admin" };
  try {
    data = event.data.json();
  } catch {
    // ignore malformed payloads, fall back to defaults above
  }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      data: { url: data.url || "/admin", ackToken: data.ackToken },
      icon: "/icon-192.png",
      badge: "/badge-96.png",
      tag: data.tag || "wagonwheel-booking",
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [200, 100, 200, 100, 400],
      timestamp: Date.now(),
      /* The button that stops the repeats. Without it the only way to acknowledge is to open the
         admin, which is a lot to ask of someone glancing at a lock screen -- and an alert that is
         awkward to acknowledge gets swiped instead, which looks identical to being acknowledged
         but leaves the office no better informed. Ignored by browsers that don't support actions,
         where tapping the notification body does the same job. */
      actions: data.ackToken ? [{ action: "ack", title: "Got it" }] : [],
    })
  );
});

/* Offline, or the server is down. The alert stays pending and the next reminder arrives on
   schedule, which is the right way to fail: a repeat is cheap, an alert silently marked as seen
   when nobody saw it is the whole problem this feature exists to prevent. */
function acknowledge(ackToken, via) {
  if (!ackToken) return Promise.resolve();
  return fetch("/api/alerts/ack", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: ackToken, via }),
  }).catch(() => {});
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url = "/admin", ackToken } = event.notification.data ?? {};

  /* Both paths acknowledge. Tapping the body is every bit as good a signal that a person has seen
     the booking as tapping "Got it" -- the only difference is whether they also wanted the admin
     opened. Acknowledging on one but not the other would mean the more engaged response is the
     one that keeps buzzing at you. */
  if (event.action === "ack") {
    event.waitUntil(acknowledge(ackToken, "notification-action"));
    return;
  }

  event.waitUntil(
    Promise.all([
      acknowledge(ackToken, "notification-open"),
      self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
        for (const client of clients) {
          if (client.url.includes(url) && "focus" in client) return client.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow(url);
      }),
    ])
  );
});

/* Chrome fires beforeinstallprompt -- the event the "Install this app" button hangs off -- only for
   a service worker with a real fetch handler. (Installing from Chrome's own ... menu stopped needing
   one in Chrome 108; the scripted prompt still does.) An empty handler is detected and ignored, so
   this has to do actual work.

   It deliberately does the least work that qualifies. Everything in this worker's scope is under
   /admin, which sits behind Basic Auth and answers with guest names, emails and phone numbers --
   none of that belongs in the Cache API. Navigations are left alone entirely, so a 401 challenge
   still reaches the browser instead of being answered by a worker that can't show a login box.
   That leaves the scripts: assetVersion.js stamps them with ?v=<content hash>, so a cached entry
   can never go stale -- an edited file is a different URL. */
const ASSET_CACHE = "wagonwheel-admin-assets-v1";

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Unversioned means it could change under the same URL. Only the hashed ones are safe to keep.
  if (!url.pathname.startsWith("/admin/js/") || !url.searchParams.has("v")) return;

  event.respondWith(
    caches.open(ASSET_CACHE).then(async (cache) => {
      const hit = await cache.match(request);
      if (hit) return hit;

      const response = await fetch(request);
      if (response.ok) {
        await cache.put(request, response.clone());
        /* Keep one entry per script. Without this the cache gains a fresh copy of every admin
           script on every deploy and never gives one back. */
        for (const key of await cache.keys()) {
          const keyUrl = new URL(key.url);
          if (keyUrl.pathname === url.pathname && keyUrl.search !== url.search) await cache.delete(key);
        }
      }
      return response;
    })
  );
});
