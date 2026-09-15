// POST /api/submit  — a candidate's submission payload (same shape as the submission code).
const { saveSubmission, cors, fail } = require("./_store");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });
  try {
    const p = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!p || p.v !== 1 || !Array.isArray(p.e) || typeof p.c !== "string" || !/^[A-Z0-9]{4,12}$/.test(p.c))
      return res.status(400).json({ ok: false, error: "Not a valid submission" });
    if (JSON.stringify(p).length > 200_000) return res.status(413).json({ ok: false, error: "Submission too large" });
    const t = typeof p.t === "string" && !isNaN(Date.parse(p.t)) ? p.t : new Date().toISOString();
    const id = `${p.c}-${Date.parse(t)}`;
    await saveSubmission(id, { ...p, t, id, receivedAt: new Date().toISOString() });
    res.status(200).json({ ok: true, id });
  } catch (e) { fail(res, e); }
};
