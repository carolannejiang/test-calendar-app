// Reviewer password required for everything here. Candidates activate a test through /api/open.
// GET  /api/tests?slug=... - one test, including its activation password
// GET  /api/tests          - list tests
// POST /api/tests          - create an empty test from { title, password }
// PUT  /api/tests?slug=... - update any of { title, password, events }; saving new events bumps the revision.
//                            The body's revision must be the one the reviewer loaded, or the update is refused.
const { saveTest, loadTest, readTest, listTests, cors, requireReviewer, fail } = require("./_store");
const { parseTest, slugify } = require("../shared/test");
const { ValidationError } = require("../shared/submission");

async function checkPasswordFree(test) {
  const clash = (await listTests()).find(other => other.slug !== test.slug && other.password === test.password);
  if (clash) throw new ValidationError(`The test "${clash.title}" already uses this activation password`, 409);
}

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    requireReviewer(req);
    const slug = String((req.query && req.query.slug) || "");
    const body = req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {};
    if (req.method === "GET" && slug) {
      const test = await readTest(slug);
      if (!test) throw new ValidationError("Test not found", 404);
      return res.status(200).json({ ok: true, test });
    }
    if (req.method === "GET") return res.status(200).json({ ok: true, tests: await listTests() });
    if (req.method === "POST") {
      if (!slugify(body.title)) throw new ValidationError("Use letters or numbers in the test title");
      const test = parseTest({ slug: slugify(body.title), title: body.title, password: body.password, revision: 1, events: [] });
      if (!test.password) throw new ValidationError("Set an activation password for the test");
      if (await readTest(test.slug)) throw new ValidationError("A test with this title already exists", 409);
      await checkPasswordFree(test);
      try { await saveTest(test); }
      catch (error) {
        // Two reviewers creating the same title at once: the storage refuses the second write.
        if (await readTest(test.slug)) throw new ValidationError("A test with this title already exists", 409);
        throw error;
      }
      return res.status(201).json({ ok: true, test });
    }
    if (req.method === "PUT") {
      const loaded = await loadTest(slug);
      if (!loaded) throw new ValidationError("Test not found", 404);
      const current = loaded.test;
      // Otherwise two reviewers editing from the same revision would both save as the next one,
      // and candidates on different calendars would be compared against the wrong baseline.
      if (body.revision !== current.revision) throw new ValidationError("This test changed since you opened it. Reload the page and try again.", 409);
      const test = parseTest({ ...current, ...body, slug: current.slug, revision: current.revision });
      if (!test.password) throw new ValidationError("Set an activation password for the test");
      if (JSON.stringify(test.events) !== JSON.stringify(current.events)) test.revision++;
      if (test.password !== current.password) await checkPasswordFree(test);
      await saveTest(test, { etag: loaded.etag });
      return res.status(200).json({ ok: true, test });
    }
    res.status(405).json({ ok: false, error: "Use GET, POST or PUT" });
  } catch (e) { fail(res, e); }
};
