// GET    /api/submissions        — list every submission (reviewer password required)
// DELETE /api/submissions?id=... — remove one (reviewer password required)
const { redis, cors, reviewerOk, fail, HASH_KEY } = require("./_store");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (!process.env.REVIEWER_PASSWORD) return res.status(503).json({ ok: false, error: "REVIEWER_PASSWORD is not set on the server" });
  if (!reviewerOk(req)) return res.status(401).json({ ok: false, error: "Wrong reviewer password" });
  try {
    if (req.method === "GET") {
      const flat = (await redis("HGETALL", HASH_KEY)) || [];
      const subs = [];
      for (let i = 0; i < flat.length; i += 2) { try { subs.push(JSON.parse(flat[i + 1])); } catch {} }
      subs.sort((a, b) => (b.t || "").localeCompare(a.t || ""));
      return res.status(200).json({ ok: true, submissions: subs });
    }
    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || "";
      if (!id) return res.status(400).json({ ok: false, error: "Missing id" });
      await redis("HDEL", HASH_KEY, id);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ ok: false, error: "Use GET or DELETE" });
  } catch (e) { fail(res, e); }
};
