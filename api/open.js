// POST /api/open { password } - the starting calendar of the test that password activates.
// Public: candidates call it from the start gate. The password itself is never returned.
const { findTestByPassword, cors, fail } = require("./_store");
const { MAX_PASSWORD } = require("../shared/test");

module.exports = async (req, res) => {
  if (cors(req, res)) return;
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Use POST" });
  try {
    const password = req.body && typeof req.body.password === "string" ? req.body.password.trim() : "";
    const test = password && password.length <= MAX_PASSWORD ? await findTestByPassword(password) : null;
    if (!test) return res.status(404).json({ ok: false, error: "That password is not correct." });
    const safe = { ...test }; delete safe.password;
    res.status(200).json({ ok: true, test: safe });
  } catch (e) { fail(res, e); }
};
