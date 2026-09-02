// Applies admin-editable text (see /admin -> Content) to any element on the page carrying a
// data-content-key attribute, and the currently-live color style (see /admin -> Styles).
// Both fail silently -- whatever's already in the HTML stays as-is if a fetch fails or a field
// is empty, so a slow/failed request never blanks or breaks the page.

fetch("/api/content")
  .then((r) => (r.ok ? r.json() : {}))
  .then((content) => {
    document.querySelectorAll("[data-content-key]").forEach((el) => {
      const key = el.getAttribute("data-content-key");
      if (Object.prototype.hasOwnProperty.call(content, key) && content[key]) {
        el.textContent = content[key];
      }
    });
  })
  .catch((err) => console.error("Failed to load editable content", err));

fetch("/api/live-style")
  .then((r) => (r.ok ? r.json() : null))
  .then((style) => {
    if (!style) return;

    const vars = style.css_vars ?? style.cssVars ?? {};
    const entries = Object.entries(vars).filter(([, v]) => v);
    if (entries.length > 0) {
      const css = ":root{" + entries.map(([k, v]) => `--${k}:${v}`).join(";") + "}";
      const styleTag = document.createElement("style");
      styleTag.textContent = css;
      document.head.appendChild(styleTag);
    }

    const logoUrl = style.logo_url ?? style.logoUrl;
    if (logoUrl) {
      document.querySelectorAll(".brand-wheel").forEach((el) => {
        const img = document.createElement("img");
        img.src = logoUrl;
        img.alt = "";
        img.className = "brand-wheel brand-logo-img";
        el.replaceWith(img);
      });
    }
  })
  .catch((err) => console.error("Failed to load live style", err));
