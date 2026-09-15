const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { payload, serverPayload, flush } = require("./helpers.cjs");

function backend() {
  const records = new Map(), writes = [], reads = [];
  let active = 0, maxActive = 0;
  const hooks = { beforeWrite: null };
  const blob = {
    BlobPreconditionFailedError: class BlobPreconditionFailedError extends Error {},
    async put(pathname, json, options) {
      writes.push({ pathname, options });
      // Lets a test simulate another writer landing between a read and this write.
      if (hooks.beforeWrite) { const hook = hooks.beforeWrite; hooks.beforeWrite = null; hook(pathname); }
      const existing = records.get(pathname);
      if (existing && !options.allowOverwrite) throw new Error("Already exists");
      if (options.ifMatch && (!existing || existing.etag !== options.ifMatch)) throw new blob.BlobPreconditionFailedError();
      records.set(pathname, { json, uploadedAt: new Date(), etag: "etag-" + writes.length });
    },
    async get(pathname) {
      reads.push(pathname); active++; maxActive = Math.max(maxActive, active);
      await flush(); active--;
      const record = records.get(pathname);
      return record ? { statusCode: 200, stream: new Response(record.json).body, blob: { etag: record.etag } } : null;
    },
    async list({ cursor = "0" }) {
      const offset = Number(cursor);
      const all = [...records].map(([pathname, record]) => ({ pathname, uploadedAt: record.uploadedAt }));
      const page = all.slice(offset, offset + 40);
      return { blobs: page, hasMore: offset + 40 < all.length, cursor: String(offset + 40) };
    },
    async del(pathname) { records.delete(pathname); },
  };
  const cache = {};
  const environment = { BLOB_READ_WRITE_TOKEN: "fake-token", REVIEWER_PASSWORD: "review-password" };
  function load(name) {
    if (cache[name]) return cache[name];
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "api", name + ".js"), "utf8"), {
      module, process: { env: environment }, Response, Buffer,
      require: name => name === "@vercel/blob" ? blob : name === "./_store" ? load("_store") : require(name),
    });
    return cache[name] = module.exports;
  }
  async function request(name, { method = "GET", body, query = {}, password = "review-password" } = {}) {
    const response = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; }, end() {} };
    await load(name)({ method, body, query, headers: { "x-reviewer-password": password } }, response);
    return response;
  }
  return { records, writes, reads, request, environment, hooks, maxActive: () => maxActive };
}

test("public POST generates immutable IDs and records server receipt time", async () => {
  const api = backend();
  const first = await api.request("submit", { method: "POST", body: payload({ t: "2000-01-01T00:00:00Z", id: "attacker-controlled" }) });
  const second = await api.request("submit", { method: "POST", body: payload({ t: "2000-01-01T00:00:00Z" }) });
  assert.equal(first.statusCode, 201); assert.equal(second.statusCode, 201);
  assert.notEqual(first.body.id, second.body.id); assert.equal(api.records.size, 2);
  assert.equal(api.writes[0].options.allowOverwrite, false);
  assert(Date.parse(first.body.receivedAt) > Date.parse("2025-01-01"));
});

test("API rejects invalid bodies with 400 and enforces reviewer authentication", async () => {
  const api = backend();
  for (const body of ["{", payload({ e: [null] }), payload({ d: { "2026-09-14": 42 } })]) {
    assert.equal((await api.request("submit", { method: "POST", body })).statusCode, 400);
  }
  assert.equal(api.records.size, 0);
  for (const password of ["wrong", "review-passworD", ["review-password"], null]) {
    const rejected = await api.request("submissions", { password });
    assert.equal(rejected.statusCode, 401);
    assert.equal(rejected.body.error, "Wrong reviewer password");
  }
  api.environment.REVIEWER_PASSWORD = "";
  const missingConfiguration = await api.request("submissions");
  assert.equal(missingConfiguration.statusCode, 503);
  assert.equal(missingConfiguration.body.error, "REVIEWER_PASSWORD is not set on the server");
});

test("listing downloads one page with bounded concurrency and paginates without repeats", async () => {
  const api = backend();
  for (let index = 0; index < 105; index++) {
    const id = "ABCDEF-" + (1000 + index);
    const receivedAt = new Date(Date.UTC(2026, 8, 14, 0, index)).toISOString();
    api.records.set(`submissions/${id}.json`, { uploadedAt: receivedAt, json: JSON.stringify(serverPayload({ id, receivedAt, t: index === 0 ? "2099-01-01T00:00:00Z" : payload().t })) });
  }
  const first = await api.request("submissions");
  assert.equal(first.body.submissions.length, 50); assert.equal(api.reads.length, 50);
  assert.equal(first.body.submissions[0].id, "ABCDEF-1104");
  assert(api.maxActive() > 1 && api.maxActive() <= 8);
  // Deleting the cursor record does not cause the next page to skip or repeat entries.
  api.records.delete("submissions/" + first.body.submissions.at(-1).id + ".json");
  const second = await api.request("submissions", { query: { cursor: first.body.cursor } });
  const third = await api.request("submissions", { query: { cursor: second.body.cursor } });
  const ids = [...first.body.submissions, ...second.body.submissions, ...third.body.submissions].map(p => p.id);
  assert.equal(new Set(ids).size, 105); assert.equal(ids.length, 105); assert.equal(third.body.cursor, null);
  assert.equal((await api.request("submissions", { query: { cursor: "garbage" } })).statusCode, 400);
});

test("invalid stored records are skipped and both legacy and UUID IDs remain deletable", async () => {
  const api = backend();
  for (const id of [serverPayload().id, "ABCDEF-123456789"]) {
    api.records.set(`submissions/${id}.json`, { uploadedAt: new Date(), json: JSON.stringify(serverPayload({ id })) });
  }
  api.records.set("submissions/BADREC-123.json", { uploadedAt: new Date(), json: JSON.stringify(serverPayload({ id: "BADREC-123", e: [null] })) });
  const listed = await api.request("submissions");
  assert.equal(listed.body.submissions.length, 2); assert.equal(listed.body.skipped, 1);
  for (const p of listed.body.submissions) assert.equal((await api.request("submissions", { method: "DELETE", query: { id: p.id } })).statusCode, 200);
  assert.equal((await api.request("submissions", { method: "DELETE", query: { id: "../elsewhere" } })).statusCode, 400);
  assert.equal(api.records.size, 1);
});

test("reviewers create tests with activation passwords and candidates open them by password alone", async () => {
  const api = backend();
  assert.equal((await api.request("tests", { method: "POST", body: { title: "Ops Round 2!", password: "fall-2026" }, password: "wrong" })).statusCode, 401);
  assert.equal((await api.request("tests", { method: "POST", body: { title: "???", password: "fall-2026" } })).statusCode, 400);
  assert.equal((await api.request("tests", { method: "POST", body: { title: "Ops Round 2!" } })).statusCode, 400);
  const created = await api.request("tests", { method: "POST", body: { title: "Ops Round 2!", password: " fall-2026 " } });
  assert.equal(created.statusCode, 201);
  assert.equal(JSON.stringify(created.body.test), JSON.stringify({ slug: "ops-round-2", title: "Ops Round 2!", password: "fall-2026", revision: 1, events: [] }));
  assert.equal(api.writes.at(-1).options.allowOverwrite, false);
  assert.equal((await api.request("tests", { method: "POST", body: { title: "ops round 2", password: "other" } })).statusCode, 409);
  const clash = await api.request("tests", { method: "POST", body: { title: "Second test", password: "fall-2026" } });
  assert.equal(clash.statusCode, 409); assert.match(clash.body.error, /already uses this activation password/);
  assert.equal(api.records.size, 1);
  // Two reviewers creating the same title at once: the storage refuses the second write, which is reported as a conflict.
  api.hooks.beforeWrite = pathname => api.records.set(pathname, { json: JSON.stringify({ ...created.body.test, slug: "third", title: "Third" }), uploadedAt: new Date(), etag: "raced" });
  const raced = await api.request("tests", { method: "POST", body: { title: "Third", password: "third" } });
  assert.equal(raced.statusCode, 409); assert.match(raced.body.error, /already exists/);
  api.records.delete("tests/third.json");

  // PUT merges: the password alone keeps the calendar and revision; new events bump the revision.
  // Every update names the revision it was based on, so two reviewers cannot both save as the same next revision.
  const events = [{ id: "a", title: "Kickoff", date: "2026-09-15", start: 600, end: 660, color: "blue", detail: "" }];
  assert.equal((await api.request("tests", { method: "PUT", query: { slug: "ops-round-2" }, body: { revision: 1, events: [null] } })).statusCode, 400);
  assert.equal((await api.request("tests", { method: "PUT", query: { slug: "nope" }, body: { revision: 1, events } })).statusCode, 404);
  for (const revision of [undefined, "1", 2, 99]) {
    const stale = await api.request("tests", { method: "PUT", query: { slug: "ops-round-2" }, body: { revision, events } });
    assert.equal(stale.statusCode, 409, String(revision)); assert.match(stale.body.error, /changed since you opened it/);
  }
  const updated = await api.request("tests", { method: "PUT", query: { slug: "ops-round-2" }, body: { events, slug: "other", revision: 1 } });
  assert.equal(updated.statusCode, 200); assert.equal(JSON.stringify(updated.body.test.events), JSON.stringify(events));
  assert.equal(updated.body.test.slug, "ops-round-2"); assert.equal(updated.body.test.revision, 2); assert.equal(updated.body.test.password, "fall-2026");
  assert.equal(api.writes.at(-1).options.ifMatch, "etag-1");
  // A write that lands between reading the record and saving it is refused by the storage precondition.
  api.hooks.beforeWrite = pathname => { api.records.get(pathname).etag = "someone-else"; };
  const overlapped = await api.request("tests", { method: "PUT", query: { slug: "ops-round-2" }, body: { revision: 2, password: "spring-2026" } });
  assert.equal(overlapped.statusCode, 409); assert.match(overlapped.body.error, /changed since you opened it/);
  api.records.get("tests/ops-round-2.json").etag = "etag-4";
  const renamed = await api.request("tests", { method: "PUT", query: { slug: "ops-round-2" }, body: { revision: 2, password: "winter-2026" } });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.body.test.revision, 2); assert.equal(renamed.body.test.password, "winter-2026");
  assert.equal(JSON.stringify(renamed.body.test.events), JSON.stringify(events));
  assert.equal((await api.request("tests", { method: "PUT", query: { slug: "ops-round-2" }, body: { revision: 2, password: "" } })).statusCode, 400);
  assert.equal(api.records.size, 1); assert.equal(api.writes.at(-1).options.allowOverwrite, true);

  // Reading a test by slug needs the reviewer password; the activation password only works through /api/open.
  assert.equal((await api.request("tests", { query: { slug: "ops-round-2" }, password: null })).statusCode, 401);
  assert.equal((await api.request("tests", { query: { slug: "ops-round-2" } })).body.test.password, "winter-2026");
  assert.equal((await api.request("tests", { query: { slug: "missing" } })).statusCode, 404);
  for (const body of [{ password: "fall-2026" }, { password: "" }, { password: ["winter-2026"] }, "winter-2026", undefined]) {
    const rejected = await api.request("open", { method: "POST", body, password: null });
    assert.equal(rejected.statusCode, 404); assert.equal(rejected.body.error, "That password is not correct.");
  }
  const opened = await api.request("open", { method: "POST", body: { password: " winter-2026 " }, password: null });
  assert.equal(opened.statusCode, 200);
  assert.equal(JSON.stringify(opened.body.test), JSON.stringify({ slug: "ops-round-2", title: "Ops Round 2!", revision: 2, events }));
  assert.equal((await api.request("open", { password: null })).statusCode, 405);
  api.records.set("tests/broken.json", { uploadedAt: new Date(), json: "{" });
  const listed = await api.request("tests");
  assert.equal(JSON.stringify(listed.body.tests), JSON.stringify([{ slug: "ops-round-2", title: "Ops Round 2!", password: "winter-2026" }]));
  assert.equal((await api.request("tests", { method: "DELETE" })).statusCode, 405);
});
