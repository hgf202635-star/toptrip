/* =========================================================
TOP TRIP — Reviews API
Cloudflare Pages (advanced mode) + D1 database

Routes:
  GET  /api/reviews   -> list of published reviews (newest first)
  POST /api/reviews   -> publish a new review immediately

Setup (once):
  1) Create a D1 database (any name, e.g. toptrip-reviews).
  2) Pages project -> Settings -> Bindings -> Add -> D1 database
     Variable name: DB    (must be exactly DB)
  3) Re-deploy the site with this _worker.js and _routes.json
     next to index.html.

The table is created automatically on the first request.

Hide a bad review later (D1 console):
  UPDATE reviews SET hidden = 1 WHERE id = '<id>';
See the private contact details:
  SELECT name, contact, text, created FROM reviews ORDER BY created DESC;
========================================================= */

const LIMITS = {
  list: 60,
  name: 40,
  text: 600,
  minText: 10,
  contact: 80,
  perHour: 3,
  maxBody: 8000
};

const TOURS = [
  "رحلة الباجي — 30 دقيقة",
  "رحلة الباجي — 15 دقيقة"
];

const TAGS = ["thrill", "views", "team", "safe", "value", "family", "photo"];
const SUBS = ["safety", "vehicle", "guide", "value"];

/* blocks links and web addresses inside reviews (spam) */
const LINK_RE = /(https?:\/\/|www\.|\b[\w-]+\.(com|net|org|sa|io|xyz|top|click|link|ru|info)\b)/i;

let tableReady = false;

function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extra
    }
  });
}

function invalid(status = 400) {
  return json({ ok: false, error: "invalid" }, status);
}

function oneLine(value, max) {
  if (typeof value !== "string") return "";

  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function multiLine(value, max) {
  if (typeof value !== "string") return "";

  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

function parseJsonSafe(value, fallback) {
  try {
    const parsed = JSON.parse(value);
    return parsed === null || parsed === undefined ? fallback : parsed;
  } catch (e) {
    return fallback;
  }
}

async function hashIp(ip, salt) {
  const data = new TextEncoder().encode(salt + "|" + ip);
  const digest = await crypto.subtle.digest("SHA-256", data);

  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 32);
}

async function ensureTable(db) {
  if (tableReady) return;

  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS reviews (" +
        "id TEXT PRIMARY KEY, " +
        "name TEXT NOT NULL, " +
        "tour TEXT NOT NULL DEFAULT '', " +
        "rating INTEGER NOT NULL, " +
        "sub TEXT NOT NULL DEFAULT '{}', " +
        "tags TEXT NOT NULL DEFAULT '[]', " +
        "text TEXT NOT NULL, " +
        "recommend INTEGER NOT NULL DEFAULT 0, " +
        "contact TEXT NOT NULL DEFAULT '', " +
        "ip_hash TEXT NOT NULL DEFAULT '', " +
        "hidden INTEGER NOT NULL DEFAULT 0, " +
        "created INTEGER NOT NULL)"
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_reviews_visible ON reviews (hidden, created DESC)"
    ),
    db.prepare(
      "CREATE INDEX IF NOT EXISTS idx_reviews_ip ON reviews (ip_hash, created)"
    )
  ]);

  tableReady = true;
}

/* what visitors are allowed to see (never the contact details) */
function toPublic(row) {
  const tags = parseJsonSafe(row.tags, []);

  return {
    id: String(row.id),
    name: row.name,
    tour: row.tour || "",
    rating: row.rating,
    tags: Array.isArray(tags) ? tags.filter((t) => TAGS.includes(t)) : [],
    text: row.text,
    recommend: row.recommend === 1,
    date: new Date(row.created).toISOString()
  };
}

async function handleGet(env) {
  if (!env.DB) return json({ ok: false, error: "not_configured" }, 503);

  try {
    await ensureTable(env.DB);

    const result = await env.DB.prepare(
      "SELECT id, name, tour, rating, tags, text, recommend, created " +
        "FROM reviews WHERE hidden = 0 ORDER BY created DESC LIMIT ?"
    )
      .bind(LIMITS.list)
      .all();

    return json((result.results || []).map(toPublic));
  } catch (e) {
    return json({ ok: false, error: "server" }, 500);
  }
}

async function handlePost(request, env) {
  if (!env.DB) return json({ ok: false, error: "not_configured" }, 503);

  /* only accept submissions coming from this same website */
  const origin = request.headers.get("Origin");

  if (origin) {
    let originHost = "";

    try {
      originHost = new URL(origin).host;
    } catch (e) {}

    if (originHost !== new URL(request.url).host) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
  }

  const type = request.headers.get("Content-Type") || "";

  if (!type.includes("application/json")) return invalid(415);

  let raw = "";

  try {
    raw = await request.text();
  } catch (e) {
    return invalid();
  }

  if (raw.length > LIMITS.maxBody) return invalid(413);

  let body = null;

  try {
    body = JSON.parse(raw);
  } catch (e) {
    return invalid();
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) return invalid();

  /* hidden trap field: bots fill it, people never see it */
  if (typeof body.hp === "string" && body.hp.trim() !== "") {
    return json({ ok: true }, 201);
  }

  const name = oneLine(body.name, LIMITS.name);
  const text = multiLine(body.text, LIMITS.text);
  const rating = Math.round(Number(body.rating));

  if (!name || text.length < LIMITS.minText || !(rating >= 1 && rating <= 5)) {
    return invalid();
  }

  if (LINK_RE.test(name) || LINK_RE.test(text)) {
    return json({ ok: false, error: "links" }, 422);
  }

  const tour = TOURS.includes(body.tour) ? body.tour : "";

  const tags = Array.isArray(body.tags)
    ? Array.from(new Set(body.tags.filter((t) => TAGS.includes(t)))).slice(0, TAGS.length)
    : [];

  const sub = {};

  if (body.sub && typeof body.sub === "object" && !Array.isArray(body.sub)) {
    SUBS.forEach((key) => {
      const value = Math.round(Number(body.sub[key]));
      if (value >= 1 && value <= 5) sub[key] = value;
    });
  }

  const recommend = body.recommend === true ? 1 : 0;
  const contact = oneLine(body.contact, LIMITS.contact);

  try {
    await ensureTable(env.DB);

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const ipHash = await hashIp(ip, env.REVIEW_SALT || "top-trip");
    const now = Date.now();

    /* max reviews per visitor per hour */
    const recent = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM reviews WHERE ip_hash = ? AND created > ?"
    )
      .bind(ipHash, now - 60 * 60 * 1000)
      .first();

    if (recent && recent.n >= LIMITS.perHour) {
      return json({ ok: false, error: "rate_limit" }, 429, { "Retry-After": "3600" });
    }

    const id = crypto.randomUUID();

    await env.DB.prepare(
      "INSERT INTO reviews " +
        "(id, name, tour, rating, sub, tags, text, recommend, contact, ip_hash, hidden, created) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)"
    )
      .bind(
        id,
        name,
        tour,
        rating,
        JSON.stringify(sub),
        JSON.stringify(tags),
        text,
        recommend,
        contact,
        ipHash,
        now
      )
      .run();

    return json(
      {
        ok: true,
        review: toPublic({
          id,
          name,
          tour,
          rating,
          tags: JSON.stringify(tags),
          text,
          recommend,
          created: now
        })
      },
      201
    );
  } catch (e) {
    return json({ ok: false, error: "server" }, 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/reviews" || url.pathname === "/api/reviews/") {
      if (request.method === "GET") return handleGet(env);
      if (request.method === "POST") return handlePost(request, env);

      return json({ ok: false, error: "method_not_allowed" }, 405, {
        Allow: "GET, POST"
      });
    }

    /* everything else is the normal static website */
    return env.ASSETS.fetch(request);
  }
};
