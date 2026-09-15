const { randomUUID } = require("node:crypto");
const { parseSubmission } = require("../shared/submission");
const { saveSubmission, cors, fail } = require("./_store");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });
  try {
    const payload = parseSubmission(req.body);
    const id = randomUUID();
    const receivedAt = new Date().toISOString();
    await saveSubmission(id, { ...payload, id, receivedAt });
    res.status(201).json({ ok: true, id, receivedAt });
  } catch (e) { fail(res, e); }
};
