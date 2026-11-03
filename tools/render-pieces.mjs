// Renders the print pieces to trim-size PDFs (admin/render) and small JPEG thumbnails
// (admin/thumbs). Run from ~/.local/vncstack with the sysroot Chrome (see the vault's
// chrome-in-containers note):  node render-pieces.mjs <repo> [piece ...]
// Serves public/ + admin/ itself and proxies /photos/* to the live site, because the
// hand-made pieces load gallery photos from the public photo API.
import { chromium } from "playwright";
import http from "node:http"; import https from "node:https"; import fs from "node:fs"; import path from "node:path";
const REPO = process.argv[2]; const only = process.argv.slice(3);
const PIECES = {
  "business-card":    { pdf: true,  sheet: ".bc-sheet" },
  "tri-fold":         { pdf: true,  sheet: ".tf-sheet" },
  "letter-flyer":     { pdf: true,  sheet: ".lf-sheet" },
  "half-sheet-two-up":{ pdf: true,  sheet: ".tu-sheet" },
  "social-square":    { pdf: false, sheet: ".sheet, .square, .ss-sheet" },
  "brochure":         { pdf: false, sheet: ".sheet-page" },
  "review-flyer":     { pdf: true,  sheet: ".sheet" },
};
const MIME = { ".html":"text/html", ".css":"text/css", ".js":"text/javascript", ".woff2":"font/woff2", ".jpg":"image/jpeg", ".png":"image/png", ".svg":"image/svg+xml", ".json":"application/json", ".yaml":"text/yaml" };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/photos/")) { https.get("https://banderawagonwheelrv.com" + req.url, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); }).on("error", () => { res.writeHead(502); res.end(); }); return; }
  const root = u.pathname.startsWith("/admin/") ? path.join(REPO, u.pathname) : path.join(REPO, "public", u.pathname);
  fs.readFile(root, (err, data) => { if (err) { res.writeHead(404); return res.end(); } res.writeHead(200, { "content-type": MIME[path.extname(root)] || "application/octet-stream" }); res.end(data); });
}).listen(8765);
const browser = await chromium.launch({ headless: true, args: ["--disable-dev-shm-usage"] });
for (const [name, cfg] of Object.entries(PIECES)) {
  if (only.length && !only.includes(name)) continue;
  const page = await browser.newPage({ viewport: { width: 1300, height: 1000 }, deviceScaleFactor: 1 });
  const errs = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("requestfailed", (r) => errs.push("FAILED " + r.url()));
  await page.goto(`http://127.0.0.1:8765/admin/${name}.html`, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready); await page.waitForTimeout(500);
  if (cfg.pdf) { await page.emulateMedia({ media: "print" }); await page.pdf({ path: `${REPO}/admin/render/${name}.pdf`, preferCSSPageSize: true, printBackground: true }); await page.emulateMedia({ media: "screen" }); }
  const el = page.locator(cfg.sheet).first();
  const w = (await el.boundingBox())?.width || 800;
  await page.evaluate((z) => { document.documentElement.style.zoom = String(z); }, 480 / w);
  await page.waitForTimeout(300);
  await page.locator(cfg.sheet).first().screenshot({ path: `${REPO}/admin/thumbs/${name}.jpg`, type: "jpeg", quality: 62 });
  console.log(name, cfg.pdf ? "pdf+thumb" : "thumb", errs.length ? errs : "clean");
  await page.close();
}
await browser.close(); server.close();
