const { test } = require("node:test");
const assert = require("node:assert/strict");
const compression = require("lz-string");
const submission = require("../shared/submission");
const { layoutColumns, describeChanges } = require("../shared/calendar");
const { mergeSubmissions, submissionKey, sortSubmissions } = require("../shared/review");
const { createStorage } = require("../shared/storage");
const { parseTest, slugify } = require("../shared/test");
const { payload, serverPayload, event } = require("./helpers.cjs");

test("submission schema rejects malformed events, notes, IDs, dates and timing", () => {
  for (const override of [
    { c: '<img src=x onerror="alert(1)">' }, { e: [null] }, { d: { "2026-09-14": 123 } },
    { s: null }, { t: "invalid" }, { a: -1 },
    { e: [["mon1", "Meeting", "2026-02-30", 540, 600, 0, "blue"]] },
    { e: [["mon1", "Meeting", "2026-09-14", 600, 540, 0, "blue"]] },
    { e: [payload().e[0], payload().e[0]] },
  ]) assert.throws(() => submission.parseSubmission(payload(override)), submission.ValidationError);
  assert.throws(() => submission.parseSubmission("{"), { status: 400 });
  assert.throws(() => submission.parseSubmission(payload({ unknown: "💡".repeat(60_000) })), { status: 413 });
});

test("payload validation strips client-selected IDs and provenance", () => {
  const parsed = submission.parseSubmission(serverPayload({ _server: true }));
  assert.equal(parsed.id, undefined); assert.equal(parsed.receivedAt, undefined); assert.equal(parsed._server, undefined);
  assert.equal(submission.parseSubmission(serverPayload(), { server: true }).id, serverPayload().id);
});

test("Unicode and existing v1 tuple fields round-trip through both backup codecs", () => {
  const p = payload({ d: { "2026-09-14": "• Café, 中文, 😀" }, e: [["mon1", "Legacy all-day event", "2026-09-14", 540, 600, 1, "blue", "Reasoning"]] });
  for (const library of [undefined, compression]) {
    const code = submission.encodePayload(p, library);
    assert.deepEqual(submission.decodePayload("https://example.test/#review=" + code, library), submission.parseSubmission(p));
  }
  assert.deepEqual(submission.decodePayload("B1." + Buffer.from(JSON.stringify(p)).toString("base64url")), submission.parseSubmission(p));
});

test("layout separates overlapping events, reuses columns, and does not mutate input", () => {
  const events = [event({ id: "a", start: 540, end: 660 }), event({ id: "b", start: 570, end: 600 }), event({ id: "c", start: 600, end: 630 }), event({ id: "d", start: 660, end: 690 })];
  const original = structuredClone(events);
  const byId = Object.fromEntries(layoutColumns(events).map(e => [e.id, e]));
  assert.equal(byId.a._cols, 2); assert.notEqual(byId.a._col, byId.b._col);
  assert.equal(byId.b._col, byId.c._col); assert.equal(byId.d._cols, 1);
  assert.deepEqual(events, original);
});

test("change descriptions use the explicit seed and preserve legacy all-day changes", () => {
  const seed = new Map([["mon1", event()]]);
  assert.deepEqual(describeChanges([event()], seed), []);
  assert.equal(describeChanges([event({ allDay: true })], seed)[0].kind, "moved");
  assert.equal(describeChanges([], seed)[0].kind, "deleted");
  const otherSeed = [event({ start: 600, end: 660 })];
  assert.deepEqual(describeChanges(otherSeed, new Map(otherSeed.map(e => [e.id, e]))), []);
});

test("refresh replaces server cache, keeps imports and sorts by server receipt", () => {
  const backup = payload({ c: "BACKUP" });
  const old = { ...serverPayload(), _server: true };
  assert.deepEqual(mergeSubmissions([old, backup], [], { replaceServer: true }), [backup]);
  const newer = serverPayload({ id: "11111111-1111-4111-8111-111111111111", c: "NEWREC", t: "2000-01-01T00:00:00Z", receivedAt: "2026-09-16T00:00:00Z" });
  assert.equal(submissionKey(sortSubmissions([old, newer])[0]), newer.id);
  const merged = mergeSubmissions([payload()], [old]);
  assert.equal(merged.length, 1); assert.equal(merged[0].id, old.id);
  assert.equal(mergeSubmissions([old], [{ ...old, id: newer.id }]).length, 2);
});

test("blocked storage supports reads, writes and reset without throwing", () => {
  let failures = 0;
  const storage = createStorage(() => { throw new Error("Blocked"); }, () => failures++);
  assert.equal(storage.get("key"), null);
  storage.set("key", "value"); assert.equal(storage.get("key"), "value");
  storage.remove("key"); assert.equal(storage.get("key"), null);
  assert.equal(failures, 3);
});

test("test titles become URL slugs and test records are validated", () => {
  assert.equal(slugify("  Ops Round 2 (Fall) — Café! "), "ops-round-2-fall-cafe");
  assert.equal(slugify("!!!"), "");
  assert.equal(slugify("x".repeat(100)).length, 60);
  const valid = { slug: "ops-round-2", title: " Ops round 2 ", events: [{ id: "a", title: "Kickoff", date: "2026-09-15", start: 600, end: 660 }] };
  assert.deepEqual(parseTest(valid), { slug: "ops-round-2", title: "Ops round 2", password: "", revision: 1, events: [{ id: "a", title: "Kickoff", date: "2026-09-15", start: 600, end: 660, color: "blue", detail: "" }] });
  assert.equal(parseTest({ ...valid, revision: 7, password: " open-sesame " }).password, "open-sesame");
  assert.deepEqual(parseTest(JSON.stringify(valid)), parseTest(valid));
  for (const override of [
    { slug: "Ops" }, { slug: "-ops" }, { revision: 0 }, { revision: "2" }, { password: 42 }, { password: "x".repeat(81) }, { slug: "ops--2" }, { slug: "../x" }, { title: "" }, { title: "   " }, { title: "x".repeat(81) },
    { events: null }, { events: [null] }, { events: [{ id: "a", date: "2026-02-30", start: 600, end: 660 }] },
    { events: [{ id: "a", date: "2026-09-15", start: 660, end: 600 }] }, { events: [{ id: "a", date: "2026-09-15", start: 600, end: 660, color: "pink" }] },
    { events: [valid.events[0], valid.events[0]] },
  ]) assert.throws(() => parseTest({ ...valid, ...override }), submission.ValidationError, JSON.stringify(override));
  assert.throws(() => parseTest("{"), { status: 400 });
  assert.throws(() => parseTest({ ...valid, padding: "x".repeat(250_000) }), { status: 413 });
});
