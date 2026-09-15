// Shared helpers for the serverless functions. Files starting with "_" are not routed.
// Storage: Vercel Blob (private access). Creating a Blob store on the project sets
// BLOB_READ_WRITE_TOKEN automatically; the SDK reads it from the environment.

const { put, get, list, del } = require("@vercel/blob");
const PREFIX = "submissions/";

function configured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const e = new Error("Storage is not configured. Create a Blob store on this Vercel project.");
    e.status = 503; throw e;
  }
}

async function saveSubmission(id, obj) {
  configured();
  await put(PREFIX + id + ".json", JSON.stringify(obj), {
    access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: true,
  });
}

async function readSubmission(pathname) {
  const r = await get(pathname, { access: "private", useCache: false });
  if (!r || r.statusCode !== 200) return null;
  const text = await new Response(r.stream).text();
  try { return JSON.parse(text); } catch { return null; }
}

async function listSubmissions() {
  configured();
  const out = [];
  let cursor;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor });
    for (const b of page.blobs) { const p = await readSubmission(b.pathname); if (p) out.push(p); }
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  return out;
}

async function deleteSubmission(id) {
  configured();
  await del(PREFIX + id + ".json");
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

module.exports = { saveSubmission, listSubmissions, deleteSubmission, cors, reviewerOk, fail };
