// Private Blob storage. The SDK reads BLOB_READ_WRITE_TOKEN from the environment.
const { createHash, timingSafeEqual } = require("node:crypto");
const { put, get, list, del } = require("@vercel/blob");
const { parseSubmission, ValidationError, isSubmissionId } = require("../shared/submission");
const PREFIX = "submissions/";
const PAGE_SIZE = 50;
const READ_CONCURRENCY = 8;

function configured() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    const error = new Error("Storage is not configured. Create a Blob store on this Vercel project.");
    error.status = 503;
    throw error;
  }
}

async function saveSubmission(id, payload) {
  configured();
  await put(PREFIX + id + ".json", JSON.stringify(payload), {
    access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: false,
  });
}

async function readSubmission(pathname) {
  const response = await get(pathname, { access: "private", useCache: false });
  if (!response || response.statusCode !== 200) return null;
  const json = await new Response(response.stream).text();
  try { return parseSubmission(json, { server: true }); }
  catch (error) {
    if (error instanceof ValidationError) return null;
    throw error;
  }
}

function decodeCursor(cursor) {
  if (!cursor) return null;
  try {
    if (typeof cursor !== "string" || cursor.length > 512) throw new Error();
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!Number.isFinite(value.time) || typeof value.path !== "string" ||
        !value.path.startsWith(PREFIX) || !value.path.endsWith(".json") ||
        !isSubmissionId(value.path.slice(PREFIX.length, -5))) throw new Error();
    return value;
  } catch { throw new ValidationError("Invalid pagination cursor"); }
}
const compareBlobs = (a, b) => b.time - a.time || a.path.localeCompare(b.path);

async function listSubmissions({ cursor } = {}) {
  configured();
  const boundary = decodeCursor(cursor);
  // List lightweight metadata to find the newest page; download only that page's bodies.
  const blobs = [];
  let storageCursor;
  do {
    const page = await list({ prefix: PREFIX, limit: 1000, cursor: storageCursor });
    blobs.push(...page.blobs.map(blob => ({ path: blob.pathname, time: new Date(blob.uploadedAt).getTime() })));
    storageCursor = page.hasMore ? page.cursor : undefined;
  } while (storageCursor);
  const remaining = blobs.sort(compareBlobs).filter(blob => !boundary || compareBlobs(blob, boundary) > 0);
  const page = remaining.slice(0, PAGE_SIZE);
  const submissions = new Array(page.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, page.length) }, async () => {
    while (next < page.length) {
      const index = next++;
      submissions[index] = await readSubmission(page[index].path);
    }
  }));
  return {
    submissions: submissions.filter(Boolean),
    cursor: remaining.length > PAGE_SIZE ? Buffer.from(JSON.stringify(page[page.length - 1])).toString("base64url") : null,
    skipped: submissions.filter(p => !p).length,
  };
}

async function deleteSubmission(id) {
  configured();
  await del(PREFIX + id + ".json");
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Reviewer-Password");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

function requireReviewer(req) {
  const expected = process.env.REVIEWER_PASSWORD;
  if (!expected) throw new ValidationError("REVIEWER_PASSWORD is not set on the server", 503);
  const given = req.headers["x-reviewer-password"];
  const digest = text => createHash("sha256").update(text, "utf8").digest();
  if (typeof given !== "string" || !timingSafeEqual(digest(given), digest(expected))) {
    throw new ValidationError("Wrong reviewer password", 401);
  }
}

function fail(res, error) {
  if (!error.status || error.status >= 500) console.error("API request failed", error);
  return res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : "Server error" });
}

module.exports = { saveSubmission, listSubmissions, deleteSubmission, cors, requireReviewer, fail };
