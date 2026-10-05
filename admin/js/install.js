/* "Install this app" for the admin, which is two different things behind one button.

   Android and desktop Chrome get the real one. Chrome fires beforeinstallprompt when the site
   qualifies; we keep that event and replay it on the click, and the OS install dialog appears.
   It fires once per page load and can't be conjured later, hence stashing it rather than trying
   to call prompt() from scratch.

   iOS gets instructions, because instructions are the ceiling. Safari has never shipped
   beforeinstallprompt or any other way to start an install from script -- deliberately -- so on
   an iPhone "Add to Home Screen" is a share-sheet action a person has to find by hand. The button
   there just opens the steps already written into the panel, so they're reachable on purpose
   rather than only when the page guesses the phone needs them.

   Why it matters here and not on the guest site: on iOS an installed Home Screen app is the only
   thing that gets push notifications at all. No install, no booking alerts. */
const installBtn = document.getElementById("install-btn");
const installStatus = document.getElementById("install-status");
const iosHint = document.getElementById("ios-hint");

const isIos = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
const isStandalone =
  window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;

let deferredPrompt = null;

function showInstalled() {
  installBtn.hidden = true;
  installStatus.textContent = "Running as an installed app on this device.";
  installStatus.classList.add("on");
}

/* Chrome only fires this when the manifest, icons, HTTPS and a non-empty fetch handler in sw.js all
   check out -- so the button staying hidden on Android is itself the diagnostic: something in that
   list regressed. */
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredPrompt = event;
  installBtn.textContent = "Install this app on this device";
  installBtn.hidden = false;
  installStatus.textContent =
    "Installing puts it on the Home Screen with its own icon, and keeps notifications working when the browser is closed.";
});

window.addEventListener("appinstalled", () => {
  deferredPrompt = null;
  showInstalled();
});

installBtn?.addEventListener("click", async () => {
  if (deferredPrompt) {
    installBtn.disabled = true;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    /* A dismissed prompt can't be re-shown from the same event -- Chrome fires a fresh one on a
       later visit if the site still qualifies. Say so rather than leaving a dead button. */
    deferredPrompt = null;
    installBtn.disabled = false;
    if (outcome === "accepted") {
      showInstalled();
    } else {
      installBtn.hidden = true;
      installStatus.textContent =
        "Not installed. Chrome will offer again on a later visit, or use its ⋮ menu → Add to Home screen.";
    }
    return;
  }

  if (isIos) {
    // No API to call on iOS, so surface the written steps and put them on screen.
    iosHint.hidden = false;
    iosHint.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  /* Not iOS and no prompt to replay. This was reachable for real: a [hidden] that authored CSS
     overrode meant the button rendered on Android before Chrome had offered anything, and the
     click landed in the iOS branch and appeared to do nothing at all. Say something -- a button
     that silently does nothing is the hardest kind of bug to report. */
  installStatus.textContent =
    "Chrome hasn't offered an install for this site on this device yet. Use its ⋮ menu → Add to Home screen, or reload and try again.";
});

(function init() {
  if (!installBtn || !installStatus) return;

  if (isStandalone) {
    showInstalled();
    return;
  }

  if (isIos) {
    installBtn.textContent = "How do I install this on an iPhone?";
    installBtn.hidden = false;
    installStatus.textContent =
      "On iPhone and iPad this is a manual step in Safari — notifications don't work until it's done.";
    return;
  }

  /* Everything else waits for beforeinstallprompt. If it never fires the site either doesn't
     qualify or is installed already, and a button that does nothing is worse than no button. */
  installBtn.hidden = true;
})();
