// GET    /api/submissions        — list every submission (reviewer password required)
// DELETE /api/submissions?id=... — remove one (reviewer password required)
const { listSubmissions, deleteSubmission, cors, requireReviewer, fail } = require("./_store");
const { isSubmissionId } = require("../shared/submission");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  try {
    requireReviewer(req);
    if (req.method === "GET") {
      const page = await listSubmissions({ cursor: req.query && req.query.cursor });
      return res.status(200).json({ ok: true, ...page });
    }
    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || "";
      if (!isSubmissionId(id)) return res.status(400).json({ ok: false, error: "Bad id" });
      await deleteSubmission(id);
      return res.status(200).json({ ok: true });
    }
    res.status(405).json({ ok: false, error: "Use GET or DELETE" });
  } catch (e) { fail(res, e); }
};
