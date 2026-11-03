import { createHmac, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../db.js";
import { ORIGIN } from "./seo.js";
import { draftPosts } from "./socialPosts.js";

/* Posting to the park's own Facebook Page through the Graph API, on a queue the office fills from
 * the Social posts drafts.
 *
 * This reverses the "never post by API" stance in socialPosts.js, on facts checked 2026-11-03
 * against Meta's docs rather than the 2025 note:
 *   - A Page access token obtained from a LONG-LIVED user token has no expiry. It is the user
 *     token that lasts ~60 days, and a Page token derived from a short-lived one dies with it.
 *     That is what the old note saw. connectPage() below does the long-lived exchange first.
 *   - Posting to a Page the signed-in person administers needs no App Review: Standard Access
 *     covers pages_manage_posts for anyone with a role on the Meta app. The app must be set to
 *     Live in the Meta dashboard or image posts are visible only to that person.
 *   - Facebook rejects a post identical to the previous one (error 506). The standing-ad drafts
 *     rotate their first line and the queue rotates through them, which is what satisfies that.
 * What has NOT changed: nothing here posts from live availability. The queue only holds posts a
 * person put there, and a draft keyed by id is re-rendered at post time so the rates line is the
 * booking page's current floor, not the floor from the day it was queued.
 *
 * Needs FB_APP_ID and FB_APP_SECRET (a Meta app owned by the park, Facebook Login product, redirect
 * URI {ORIGIN}/api/admin/social/facebook/callback). Without them the queue still lists and holds
 * posts; the tick just has nothing to post with, and the panel says so. */

export const GRAPH = "https://graph.facebook.com/v24.0";
const SCOPES = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];
export const CHANNEL = "facebook";

const ADMIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../admin");
/* The only local files a queued post may attach: the standing ad's two renders. Anything else on
   the queue row's image column is "photo:<id>" (a gallery photo, fetched from its public URL). */
const LOCAL_IMAGES = {
  "evergreen-square": "evergreen-ad-square.png",
  "evergreen-4x3": "evergreen-ad-4x3.png",
};
export const IMAGE_CHOICES = Object.keys(LOCAL_IMAGES);

export function configured() {
  return Boolean(process.env.FB_APP_ID && process.env.FB_APP_SECRET);
}
export const redirectUri = () => `${ORIGIN}/api/admin/social/facebook/callback`;

/* The OAuth state: an HMAC over the minute it was issued, good for ten minutes. The callback is
   behind adminAuth anyway; this just stops a stray code from someone else's dialog landing here. */
function sign(minute) {
  return createHmac("sha256", process.env.FB_APP_SECRET).update(`fb-state:${minute}`).digest("hex").slice(0, 32);
}
export function newState() {
  const minute = Math.floor(Date.now() / 60000);
  return `${minute}.${sign(minute)}`;
}
export function checkState(state) {
  const [m, sig] = String(state ?? "").split(".");
  const minute = Number(m);
  if (!Number.isInteger(minute) || !sig) return false;
  if (Math.floor(Date.now() / 60000) - minute > 10) return false;
  const want = Buffer.from(sign(minute));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

export function loginUrl() {
  const q = new URLSearchParams({
    client_id: process.env.FB_APP_ID,
    redirect_uri: redirectUri(),
    scope: SCOPES.join(","),
    state: newState(),
    response_type: "code",
  });
  return `https://www.facebook.com/v24.0/dialog/oauth?${q}`;
}

async function graph(pathname, { method = "GET", params = {}, body = null } = {}) {
  const url = new URL(`${GRAPH}/${pathname.replace(/^\//, "")}`);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) url.searchParams.set(k, v);
  const res = await fetch(url, { method, body });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    const e = json.error ?? {};
    const err = new Error(e.message || `Graph API ${res.status}`);
    err.code = e.code;
    err.subcode = e.error_subcode;
    throw err;
  }
  return json;
}

/* The pages the signed-in person can post to, with a non-expiring Page token for each: short-lived
   code -> short-lived user token -> long-lived user token -> /me/accounts. */
export async function pagesForCode(code) {
  const short = await graph("oauth/access_token", {
    params: { client_id: process.env.FB_APP_ID, client_secret: process.env.FB_APP_SECRET, redirect_uri: redirectUri(), code },
  });
  const long = await graph("oauth/access_token", {
    params: {
      grant_type: "fb_exchange_token",
      client_id: process.env.FB_APP_ID,
      client_secret: process.env.FB_APP_SECRET,
      fb_exchange_token: short.access_token,
    },
  });
  const me = await graph("me", { params: { fields: "id,name", access_token: long.access_token } });
  const pages = await graph("me/accounts", { params: { fields: "id,name,access_token,tasks", access_token: long.access_token } });
  return {
    user: me,
    pages: (pages.data ?? []).filter((p) => (p.tasks ?? []).includes("CREATE_CONTENT")),
  };
}

export async function connectPage({ pageId, pageName, token, by }) {
  await pool.query(
    `INSERT INTO social_accounts (channel, page_id, page_name, access_token, connected_at, connected_by)
       VALUES ($1, $2, $3, $4, now(), $5)
       ON CONFLICT (channel) DO UPDATE SET page_id = EXCLUDED.page_id, page_name = EXCLUDED.page_name,
         access_token = EXCLUDED.access_token, connected_at = now(), connected_by = EXCLUDED.connected_by`,
    [CHANNEL, pageId, pageName, token, by ?? null]
  );
}
export async function disconnect() {
  await pool.query(`DELETE FROM social_accounts WHERE channel = $1`, [CHANNEL]);
}
/* Never returns the token: the panel only needs to know which Page, and since when. */
export async function account() {
  const { rows } = await pool.query(
    `SELECT page_id, page_name, connected_at, connected_by FROM social_accounts WHERE channel = $1`,
    [CHANNEL]
  );
  return rows[0] ?? null;
}
async function accountWithToken() {
  const { rows } = await pool.query(`SELECT page_id, access_token FROM social_accounts WHERE channel = $1`, [CHANNEL]);
  return rows[0] ?? null;
}

/* ---- the queue ---- */

export async function listQueue() {
  const { rows } = await pool.query(
    `SELECT id, draft_id, text, image, link, publish_at, repeat_days, status, fb_post_id, error, posted_at, created_at
       FROM social_queue WHERE channel = $1
       ORDER BY (status = 'queued') DESC, publish_at DESC LIMIT 60`,
    [CHANNEL]
  );
  return rows;
}

export async function enqueue({ draftId = null, text = null, image = null, link = null, publishAt, repeatDays = null }) {
  const { rows } = await pool.query(
    `INSERT INTO social_queue (channel, draft_id, text, image, link, publish_at, repeat_days)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [CHANNEL, draftId, text, image, link, publishAt, repeatDays]
  );
  return rows[0].id;
}

export async function cancel(id) {
  const { rowCount } = await pool.query(
    `UPDATE social_queue SET status = 'cancelled' WHERE id = $1 AND channel = $2 AND status = 'queued'`,
    [id, CHANNEL]
  );
  return rowCount > 0;
}
export async function requeue(id, publishAt = new Date()) {
  const { rowCount } = await pool.query(
    `UPDATE social_queue SET status = 'queued', error = NULL, publish_at = $3
       WHERE id = $1 AND channel = $2 AND status IN ('failed', 'queued', 'cancelled')`,
    [id, CHANNEL, publishAt]
  );
  return rowCount > 0;
}

/* The standing ad's three drafts take turns: evergreen-1 -> -2 -> -3 -> -1. Any other draft id
   repeats as itself. Exported for the panel's "next time this will be…" line and for tests. */
export function nextDraftId(draftId) {
  const m = /^evergreen-(\d+)$/.exec(draftId ?? "");
  if (!m) return draftId;
  return `evergreen-${(Number(m[1]) % 3) + 1}`;
}

/* The text a queued row posts. A row with a draft id and no text of its own is rendered fresh so
   the rates line is today's; an edited text is posted as written, which is the office's call. */
async function textFor(row) {
  if (row.text) return row.text;
  if (!row.draft_id) throw new Error("Nothing to post: no text and no draft");
  const { drafts } = await draftPosts();
  const d = drafts.find((x) => x.id === row.draft_id);
  if (!d || !d.text) throw new Error(`Draft "${row.draft_id}" is not available right now`);
  return d.text;
}

async function imageSource(image) {
  if (!image) return null;
  if (LOCAL_IMAGES[image]) {
    const buf = await readFile(path.join(ADMIN_DIR, LOCAL_IMAGES[image]));
    return { blob: new Blob([buf], { type: "image/png" }), name: LOCAL_IMAGES[image] };
  }
  const m = /^photo:(\d+)$/.exec(image);
  if (m) return { url: `${ORIGIN}/photos/${m[1]}/image` };
  throw new Error(`Unknown image "${image}"`);
}

/* One post. Photo posts go to /{page}/photos (caption + the file, or a public URL); text-only or
   link posts go to /{page}/feed. Returns the Facebook post id. */
export async function publish(row) {
  const acct = await accountWithToken();
  if (!acct) throw new Error("Facebook is not connected");
  const text = await textFor(row);
  const img = await imageSource(row.image);
  if (img) {
    const form = new FormData();
    form.set("caption", text);
    form.set("access_token", acct.access_token);
    if (img.blob) form.set("source", img.blob, img.name);
    else form.set("url", img.url);
    const r = await graph(`${acct.page_id}/photos`, { method: "POST", body: form });
    return r.post_id || r.id;
  }
  const form = new FormData();
  form.set("message", text);
  form.set("access_token", acct.access_token);
  if (row.link) form.set("link", row.link);
  const r = await graph(`${acct.page_id}/feed`, { method: "POST", body: form });
  return r.id;
}

/* Everything due. Rows are claimed one at a time with FOR UPDATE SKIP LOCKED so a tick that
   overlaps a slow one (or a second container during a deploy) never posts a row twice. A failure
   is recorded on the row and left for a person: no automatic retry, because the likely causes
   (token revoked, duplicate content, app not Live) repeat identically every minute. */
export async function postDue() {
  if (!configured()) return { posted: 0, failed: 0 };
  let posted = 0, failed = 0;
  for (;;) {
    const client = await pool.connect();
    let row = null;
    try {
      await client.query("BEGIN");
      const { rows } = await client.query(
        `SELECT * FROM social_queue WHERE channel = $1 AND status = 'queued' AND publish_at <= now()
           ORDER BY publish_at FOR UPDATE SKIP LOCKED LIMIT 1`,
        [CHANNEL]
      );
      row = rows[0] ?? null;
      if (row) await client.query(`UPDATE social_queue SET status = 'posting' WHERE id = $1`, [row.id]);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
      throw err;
    }
    client.release();
    if (!row) break;
    try {
      const postId = await publish(row);
      await pool.query(
        `UPDATE social_queue SET status = 'posted', fb_post_id = $2, posted_at = now(), error = NULL WHERE id = $1`,
        [row.id, postId]
      );
      posted++;
      if (row.repeat_days) {
        /* The next turn, from the posted time rather than the scheduled one so a row that sat
           through an outage doesn't bunch up with its successor. Text is NOT carried over: the
           next turn re-renders its draft so edits made for one run stay with that run. */
        const next = new Date(Date.now() + row.repeat_days * 86400000);
        await enqueue({ draftId: nextDraftId(row.draft_id), image: row.image, link: row.link, publishAt: next, repeatDays: row.repeat_days });
      }
    } catch (err) {
      failed++;
      const msg = err.code ? `${err.message} (code ${err.code}${err.subcode ? `/${err.subcode}` : ""})` : err.message;
      await pool.query(`UPDATE social_queue SET status = 'failed', error = $2 WHERE id = $1`, [row.id, msg.slice(0, 500)]);
      console.error(`[social] post ${row.id} failed: ${msg}`);
    }
  }
  if (posted || failed) console.log(`[social] posted ${posted}, failed ${failed}`);
  return { posted, failed };
}

/* Every minute, like the booking-alert retry; the queue is tiny and the query is indexed. Not at
   boot, for the crash-loop reason in reviewRequest.js. */
export function startSocialQueueJob() {
  const run = () => postDue().catch((err) => console.error("[social] job failed:", err.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 60 * 1000).unref();
}
