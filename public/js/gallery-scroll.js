// Turns the homepage's swipeable photo strip (#gallery-grid, already styled and working with no
// JS at all -- see the "gallery" rules in style.css) into a self-scrolling banner. The strip is
// the deliberate fallback: if this script doesn't run, or the visitor prefers reduced motion,
// nothing here applies and the figures stay exactly as the server rendered them, manually
// swipeable.
//
// Autoplay pauses on hover, touch, and keyboard focus -- this only saves someone a second of
// stillness, since the same figures scroll back into view a few seconds later either way, but
// a photo someone stopped to look at should stop moving under their finger.
(() => {
  const gallery = document.getElementById("gallery-grid");
  if (!gallery) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const figures = Array.from(gallery.children);
  if (figures.length < 2) return;

  const track = document.createElement("div");
  track.className = "gallery-track";
  figures.forEach((f) => track.appendChild(f));
  figures.forEach((f) => track.appendChild(f.cloneNode(true)));
  gallery.appendChild(track);
  gallery.classList.add("gallery-auto");

  // ~30px/second, floored at 20s so a short photo set doesn't race past unreadably fast.
  const trackWidth = track.scrollWidth / 2;
  track.style.animationDuration = `${Math.max(20, Math.round(trackWidth / 30))}s`;

  const pause = () => (track.style.animationPlayState = "paused");
  const resume = () => (track.style.animationPlayState = "running");
  gallery.addEventListener("pointerenter", pause);
  gallery.addEventListener("pointerleave", resume);
  gallery.addEventListener("touchstart", pause, { passive: true });
  gallery.addEventListener("touchend", () => setTimeout(resume, 2000), { passive: true });
})();
