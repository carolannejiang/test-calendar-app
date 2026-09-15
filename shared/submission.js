// One submission contract for the browser, backup codes, and serverless handlers.
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarSubmission = api;
})(globalThis, function () {
  "use strict";
  const MAX_BYTES = 200_000;
  const CANDIDATE_PATTERN = "[A-Z0-9]{4,12}";
  const CANDIDATE_RE = new RegExp(`^${CANDIDATE_PATTERN}$`);
  const LEGACY_ID_RE = new RegExp(`^${CANDIDATE_PATTERN}--?\\d{1,16}$`);
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  const COLORS = ["blue", "green", "purple", "red", "orange", "gray"];

  class ValidationError extends Error {
    constructor(message, status = 400) {
      super(message);
      this.name = "ValidationError";
      this.status = status;
    }
  }
  const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function check(condition, message) {
    if (!condition) throw new ValidationError(message);
  }
  function text(value, max, label) {
    check(typeof value === "string" && value.length <= max, `Invalid ${label}`);
    return value;
  }
  function isDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + "T00:00:00.000Z");
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  function timestamp(value, label) {
    check(typeof value === "string" && value.length <= 50 && Number.isFinite(Date.parse(value)), `Invalid ${label}`);
    return new Date(value).toISOString();
  }
  function isSubmissionId(value) {
    return typeof value === "string" && (UUID_RE.test(value) || LEGACY_ID_RE.test(value));
  }
  function checkSize(json, allowance = 0) {
    if (new TextEncoder().encode(json).length > MAX_BYTES + allowance) throw new ValidationError("Submission too large", 413);
  }

  // Keep the v1 tuple positions (including allDay) so existing backup codes still work.
  function parseSubmission(input, { server = false } = {}) {
    let p = input;
    if (typeof input === "string") {
      checkSize(input, server ? 1024 : 0);
      try { p = JSON.parse(input); } catch { throw new ValidationError("Invalid submission JSON"); }
    } else {
      check(record(p), "Not a valid submission");
      checkSize(JSON.stringify(p), server ? 1024 : 0);
    }
    check(record(p) && p.v === 1, "Unsupported submission version");
    check(typeof p.c === "string" && CANDIDATE_RE.test(p.c), "Invalid candidate code");
    const s = text(p.s, 160, "scenario name");
    check(s.trim().length > 0, "Missing scenario name");
    const t = timestamp(p.t, "submission timestamp");
    check(Array.isArray(p.e) && p.e.length <= 500, "Invalid event list");
    const ids = new Set();
    const e = p.e.map(a => {
      check(Array.isArray(a) && a.length >= 7 && a.length <= 9, "Invalid event");
      const [id, title, date, start, end, allDay, color, notes = "", deleted = 0] = a;
      check(typeof id === "string" && /^[A-Za-z0-9_-]{1,80}$/.test(id) && !ids.has(id), "Invalid or duplicate event ID");
      ids.add(id);
      check(isDate(date), "Invalid event date");
      check(Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= 1440, "Invalid event time range");
      check((allDay === 0 || allDay === 1) && (deleted === 0 || deleted === 1), "Invalid event flags");
      check(COLORS.includes(color), "Invalid event color");
      return [id, text(title, 500, "event title"), date, start, end, allDay, color, text(notes, 20_000, "event notes"), deleted];
    });
    check(p.d === undefined || record(p.d), "Invalid day notes");
    const entries = Object.entries(p.d || {}).sort(([a], [b]) => a.localeCompare(b));
    check(entries.length <= 366, "Too many day notes");
    const d = Object.fromEntries(entries.map(([date, notes]) => {
      check(isDate(date), "Invalid day notes date");
      return [date, text(notes, 20_000, "day notes")];
    }));
    const a = p.a === undefined ? 0 : p.a;
    check(Number.isSafeInteger(a) && a >= 0, "Invalid active time");
    const o = p.o == null ? null : timestamp(p.o, "opening timestamp");
    const result = { v: 1, c: p.c, s, t, o, a, d, e };
    // Request bodies and pasted codes can never confer server provenance or choose an ID.
    if (server) {
      check(isSubmissionId(p.id), "Invalid server submission ID");
      result.id = p.id;
      if (p.receivedAt !== undefined) result.receivedAt = timestamp(p.receivedAt, "receipt timestamp");
    }
    checkSize(JSON.stringify(result), server ? 1024 : 0);
    return result;
  }

  function packEvent(e) {
    return [e.id, e.title, e.date, e.start, e.end, e.allDay ? 1 : 0, e.color, e.notes || "", e.deleted ? 1 : 0];
  }
  function unpackEvent(a) {
    return { id: a[0], title: a[1], date: a[2], start: a[3], end: a[4], allDay: !!a[5], color: a[6], notes: a[7] || "", deleted: !!a[8] };
  }
  function encodePayload(payload, compression) {
    const json = JSON.stringify(parseSubmission(payload));
    if (compression) return "C1." + compression.compressToEncodedURIComponent(json);
    const binary = Array.from(new TextEncoder().encode(json), byte => String.fromCharCode(byte)).join("");
    return "B1." + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function decodePayload(value, compression) {
    check(typeof value === "string" && value.length <= MAX_BYTES * 2, "Invalid submission code");
    let code = value.trim();
    const link = code.match(/#review=([^&\s]+)/);
    if (link) code = link[1];
    code = code.replace(/\s+/g, "");
    let json;
    if (code.startsWith("C1.")) {
      check(!!compression, "Compression library not loaded. Reconnect and reload to read this code.");
      json = compression.decompressFromEncodedURIComponent(code.slice(3));
    } else if (code.startsWith("B1.")) {
      try {
        const binary = atob(code.slice(3).replace(/-/g, "+").replace(/_/g, "/"));
        json = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, c => c.charCodeAt(0)));
      } catch { throw new ValidationError("Invalid submission code"); }
    } else throw new ValidationError("Not a submission code");
    check(typeof json === "string", "Invalid submission code");
    return parseSubmission(json);
  }
  return { MAX_BYTES, COLORS, CANDIDATE_RE, ValidationError, isDate, isSubmissionId, parseSubmission, packEvent, unpackEvent, encodePayload, decodePayload };
});
