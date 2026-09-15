// A reviewer-created test: a title, the activation password candidates enter, and its starting calendar.
// The slug is only a storage ID and a reviewer link; candidates never see it.
(function (root, factory) {
  const submission = typeof module === "object" && module.exports ? require("./submission") : root.CalendarSubmission;
  const api = factory(submission);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarTest = api;
})(globalThis, function (submission) {
  "use strict";
  const { MAX_BYTES, COLORS, ValidationError, isDate } = submission;
  const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  const MAX_SLUG = 60, MAX_TITLE = 80;
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function check(condition, message) {
    if (!condition) throw new ValidationError(message);
  }
  function text(value, max, label) {
    check(typeof value === "string" && value.length <= max, `Invalid ${label}`);
    return value;
  }

  function slugify(title) {
    return String(title ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, MAX_SLUG).replace(/-+$/, "");
  }

  function parseTest(input) {
    let p = input;
    if (typeof input === "string") {
      try { p = JSON.parse(input); } catch { throw new ValidationError("Invalid test JSON"); }
    }
    check(record(p), "Not a valid test");
    if (new TextEncoder().encode(JSON.stringify(p)).length > MAX_BYTES) throw new ValidationError("Test too large", 413);
    const title = text(p.title, MAX_TITLE, "test title").trim();
    check(title.length > 0, "Missing test title");
    const password = text(p.password ?? "", MAX_TITLE, "activation password").trim();
    check(typeof p.slug === "string" && p.slug.length <= MAX_SLUG && SLUG_RE.test(p.slug), "Invalid test slug");
    const revision = p.revision === undefined ? 1 : p.revision;
    check(Number.isSafeInteger(revision) && revision >= 1, "Invalid test revision");
    check(Array.isArray(p.events) && p.events.length <= 500, "Invalid event list");
    const ids = new Set();
    const events = p.events.map(e => {
      check(record(e), "Invalid event");
      check(typeof e.id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(e.id) && !ids.has(e.id), "Invalid or duplicate event ID");
      ids.add(e.id);
      check(isDate(e.date), "Invalid event date");
      check(Number.isInteger(e.start) && Number.isInteger(e.end) && e.start >= 0 && e.start < e.end && e.end <= 1440, "Invalid event time range");
      const color = e.color === undefined ? "blue" : e.color;
      check(COLORS.includes(color), "Invalid event color");
      return { id: e.id, title: text(e.title ?? "", 500, "event title"), date: e.date, start: e.start, end: e.end, color,
        detail: text(e.detail ?? "", 500, "event detail") };
    });
    // The revision changes whenever the starting calendar is saved, so candidate drafts and
    // submission comparisons never mix baselines (see "Changing scenarios" in the README).
    return { slug: p.slug, title, password, revision, events };
  }
  return { SLUG_RE, slugify, parseTest };
});
