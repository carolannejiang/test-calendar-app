// Shared helpers for the serverless functions. Files starting with "_" are not routed.
// Storage: Upstash Redis via its REST API (the "Upstash for Redis" store in the Vercel Marketplace).
// Connecting that store to the project sets KV_REST_API_URL / KV_REST_API_TOKEN automatically.

const URL_ = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const HASH_KEY = "cal-test:submissions";

async function redis(...cmd) {
  if (!URL_ || !TOKEN) {
    const e = new Error("Storage is not configured. Connect an Upstash Redis store to this Vercel project.");
    e.status = 503; throw e;
  }
  const r = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json();
  if (j.error) { const e = new Error(j.error); e.status = 502; throw e; }
  return j.result;
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Reviewer-Password");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

function reviewerOk(req) {
  const expected = process.env.REVIEWER_PASSWORD;
  if (!expected) return false;
  const given = req.headers["x-reviewer-password"] || "";
  if (given.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

function fail(res, err) {
  res.status(err.status || 500).json({ ok: false, error: err.message || "Server error" });
}

module.exports = { redis, cors, reviewerOk, fail, HASH_KEY };
