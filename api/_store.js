// Private Blob storage. The SDK reads BLOB_READ_WRITE_TOKEN from the environment.
const { createHash, timingSafeEqual } = require("node:crypto");
const { put, get, list, del, BlobPreconditionFailedError } = require("@vercel/blob");
const { parseSubmission, ValidationError, isSubmissionId } = require("../shared/submission");
const { parseTest, SLUG_RE } = require("../shared/test");
const PREFIX = "submissions/";
const TESTS = "tests/";
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

async function listBlobs(prefix) {
  // List lightweight metadata to find the newest page; download only that page's bodies.
  const blobs = [];
  let storageCursor;
  do {
    const page = await list({ prefix, limit: 1000, cursor: storageCursor });
    blobs.push(...page.blobs.map(blob => ({ path: blob.pathname, time: new Date(blob.uploadedAt).getTime() })));
    storageCursor = page.hasMore ? page.cursor : undefined;
  } while (storageCursor);
  return blobs;
}
async function readAll(paths, read) {
  const results = new Array(paths.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(READ_CONCURRENCY, paths.length) }, async () => {
    while (next < paths.length) {
      const index = next++;
      results[index] = await read(paths[index]);
    }
  }));
  return results;
}

async function listSubmissions({ cursor } = {}) {
  configured();
  const boundary = decodeCursor(cursor);
  const blobs = await listBlobs(PREFIX);
  const remaining = blobs.sort(compareBlobs).filter(blob => !boundary || compareBlobs(blob, boundary) > 0);
  const page = remaining.slice(0, PAGE_SIZE);
  const submissions = await readAll(page.map(blob => blob.path), readSubmission);
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

// Updates pass the etag from loadTest so two reviewers cannot both write over the same record.
async function saveTest(test, { etag } = {}) {
  configured();
  try {
    await put(TESTS + test.slug + ".json", JSON.stringify(test), {
      access: "private", contentType: "application/json", addRandomSuffix: false, allowOverwrite: !!etag, ifMatch: etag,
    });
  } catch (error) {
    if (error instanceof BlobPreconditionFailedError) throw new ValidationError("This test changed since you opened it. Reload the page and try again.", 409);
    throw error;
  }
}

async function loadTest(slug) {
  configured();
  if (!SLUG_RE.test(slug)) return null;
  const response = await get(TESTS + slug + ".json", { access: "private", useCache: false });
  if (!response || response.statusCode !== 200) return null;
  const json = await new Response(response.stream).text();
  try { return { test: parseTest(json), etag: response.blob.etag }; }
  catch (error) {
    if (error instanceof ValidationError) return null;
    throw error;
  }
}
const readTest = async slug => (await loadTest(slug))?.test || null;

async function readAllTests() {
  configured();
  const slugs = (await listBlobs(TESTS)).map(blob => blob.path.slice(TESTS.length, -5));
  return (await readAll(slugs, readTest)).filter(Boolean).sort((a, b) => a.title.localeCompare(b.title));
}

async function listTests() {
  return (await readAllTests()).map(({ slug, title, password }) => ({ slug, title, password }));
}

const digest = text => createHash("sha256").update(text, "utf8").digest();
// Candidates activate a test by password alone, so compare without leaking timing.
async function findTestByPassword(password) {
  return (await readAllTests()).find(test => test.password && timingSafeEqual(digest(test.password), digest(password))) || null;
}

function cors(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Reviewer-Password");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

function requireReviewer(req) {
  const expected = process.env.REVIEWER_PASSWORD;
  if (!expected) throw new ValidationError("REVIEWER_PASSWORD is not set on the server", 503);
  const given = req.headers["x-reviewer-password"];
  if (typeof given !== "string" || !timingSafeEqual(digest(given), digest(expected))) {
    throw new ValidationError("Wrong reviewer password", 401);
  }
}

function fail(res, error) {
  if (!error.status || error.status >= 500) console.error("API request failed", error);
  return res.status(error.status || 500).json({ ok: false, error: error.status ? error.message : "Server error" });
}

module.exports = { saveSubmission, listSubmissions, deleteSubmission, saveTest, loadTest, readTest, listTests, findTestByPassword, cors, requireReviewer, fail };
