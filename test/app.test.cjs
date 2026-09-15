const { test } = require("node:test");
const assert = require("node:assert/strict");
const { app, response, flush, payload, serverPayload, scenario, KEY, SUBMITTED_KEY } = require("./helpers.cjs");
const { encodePayload, decodePayload } = require("../shared/submission");

test("page initializes in standards mode and rejects an injected backup code", async t => {
  const ui = app({ review: true }); t.after(ui.close); await flush();
  assert.equal(ui.document.compatMode, "CSS1Compat");
  const malicious = payload({ c: '<img src=x onerror="window.compromised=true">' });
  ui.document.querySelector("#reviewInput").value = "B1." + Buffer.from(JSON.stringify(malicious)).toString("base64url");
  ui.document.querySelector("#reviewLoad").click();
  assert.equal(ui.document.querySelector("#reviewErr").hidden, false);
  assert.equal(ui.document.querySelector("#changes img"), null);
  assert.equal(ui.document.querySelectorAll("#subList li").length, 0);
  assert.equal(ui.errors.length, 0);
});

test("refresh retains selected identity, updates the displayed response, and removes missing records", async t => {
  let submissions = [serverPayload()];
  const ui = app({ review: true, fetch: async () => response({ ok: true, submissions, cursor: null }) }); t.after(ui.close); await flush();
  ui.document.querySelector("#subList .submission").click();
  submissions = [serverPayload({ id: "11111111-1111-4111-8111-111111111111", c: "UVWXYZ", receivedAt: "2026-09-16T00:00:00Z" }), serverPayload()];
  ui.document.querySelector("#serverRefresh").click(); await flush();
  assert.equal(ui.document.querySelector("#subList button.active b").textContent, "ABCDEF");
  assert.match(ui.document.querySelector("#reviewBanner").textContent, /Candidate ABCDEF/);
  assert.equal(ui.document.querySelector("button button"), null);
  submissions = [];
  ui.document.querySelector("#serverRefresh").click(); await flush();
  assert.equal(ui.document.querySelectorAll("#subList li").length, 0);
  assert.match(ui.document.querySelector("#reviewBanner").textContent, /Starting calendar/);
  assert.equal(ui.errors.length, 0);
});

test("a delayed delete removes the same record after refresh reorders the list", async t => {
  let finishDelete;
  let submissions = [serverPayload()];
  const ui = app({ review: true, fetch: async (url, options) => {
    if (options.method === "DELETE") return new Promise(resolve => { finishDelete = () => resolve(response({ ok: true })); });
    return response({ ok: true, submissions });
  } }); t.after(ui.close); await flush();
  ui.document.querySelector("#subList .x").click();
  submissions = [serverPayload({ id: "11111111-1111-4111-8111-111111111111", c: "UVWXYZ", receivedAt: "2026-09-16T00:00:00Z" }), serverPayload()];
  ui.document.querySelector("#serverRefresh").click(); await flush();
  finishDelete(); await flush();
  assert.equal(ui.document.querySelectorAll("#subList li").length, 1);
  assert.equal(ui.document.querySelector("#subList b").textContent, "UVWXYZ");
});

test("historical responses use their own dates, render legacy all-day events, and disable misleading comparisons", async t => {
  const ui = app({ review: true }); t.after(ui.close); await flush();
  const older = payload({ s: "Older scenario", e: [["mon1", "Older meeting", "2025-06-16", 540, 600, 1, "blue", "", 0]], d: { "2025-06-16": "Historical notes" } });
  ui.document.querySelector("#reviewInput").value = encodePayload(older);
  ui.document.querySelector("#reviewLoad").click();
  assert.match(ui.document.querySelector("#monthTitle").textContent, /June 2025/);
  assert.match(ui.document.querySelector("#changes").textContent, /Changes cannot be compared/);
  assert.match(ui.document.querySelector("#changes").textContent, /Historical notes/);
  assert.equal(ui.document.querySelector(".ev.moved"), null);
  assert.equal(ui.document.querySelector("#allDayHeads").hidden, false);
  assert.equal(ui.document.querySelector("#allDayHeads .ev .t").textContent, "Older meeting");
  ui.document.querySelector("#nextWeek").click();
  assert.equal(ui.document.querySelector('#dayNotes textarea').dataset.date, "2025-06-22");
  assert.equal(ui.errors.length, 0);
});

test("invalid server records do not crash reviewer rendering", async t => {
  const ui = app({ review: true, fetch: async () => response({ ok: true, submissions: [serverPayload({ e: [null] }), serverPayload()] }) });
  t.after(ui.close); await flush();
  assert.equal(ui.document.querySelectorAll("#subList li").length, 1);
  ui.document.querySelector("#subList .submission").click();
  assert.match(ui.document.querySelector("#serverStatus").textContent, /1 unreadable submission/);
  assert.equal(ui.errors.length, 0);
});

test("event dates stay within the test week and valid edits persist", t => {
  const ui = app(); t.after(ui.close);
  ui.document.querySelector('.ev[data-id="mon1"]').dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  ui.document.querySelector("#popDate").value = "2026-09-21";
  ui.document.querySelector("#popSave").click();
  assert.equal(ui.document.querySelector("#popError").hidden, false);
  assert.equal(ui.document.querySelector("#popup").hidden, false);
  ui.document.querySelector("#popDate").value = "2026-09-15";
  ui.document.querySelector("#popSave").click();
  const saved = JSON.parse(ui.window.localStorage.getItem(KEY));
  assert.equal(saved.events.find(e => e.id === "mon1").date, "2026-09-15");
  assert(ui.document.querySelector('.daycol[data-date="2026-09-15"] .ev[data-id="mon1"]'));
});

test("notes bullets persist and submission uses the local backend", async t => {
  const ui = app(); t.after(ui.close);
  const textarea = ui.document.querySelector('#dayNotes textarea[data-date="2026-09-14"]');
  textarea.value = "- Reason"; textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
  textarea.dispatchEvent(new ui.window.Event("input", { bubbles: true }));
  assert.equal(textarea.value, "• Reason");
  textarea.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(textarea.value, "• Reason\n• ");
  ui.document.querySelector("#submitBtn").click(); await flush();
  assert.equal(ui.calls[0].url, "/api/submit");
  assert.equal(JSON.parse(ui.calls[0].options.body).d["2026-09-14"], "• Reason\n•");
  assert.equal(ui.document.querySelector("#submitTitle").textContent, "Your response has been submitted.");
  assert.equal(ui.document.querySelector("#submitCode").hidden, true);
  assert.equal(ui.document.querySelector("#submitBtn").hidden, true);
  assert.equal(JSON.parse(ui.window.localStorage.getItem(SUBMITTED_KEY)).saved, true);
});

test("submitting locks the calendar and the lock survives a reload under the same candidate ID", async t => {
  const ui = app(); t.after(ui.close);
  ui.document.querySelector("#submitBtn").click(); await flush();
  assert.equal(ui.document.querySelector("#submitModal").hidden, false);
  ui.document.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  ui.document.querySelector("#submitModal").click();
  assert.equal(ui.document.querySelector("#submitModal").hidden, false);
  ui.document.querySelector('.ev[data-id="mon1"]').dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  assert.equal(ui.document.querySelector("#popup").hidden, true);
  assert.equal(ui.document.querySelector('#dayNotes textarea[data-date="2026-09-14"]').disabled, true);
  ui.document.querySelector("#submitBtn").click(); await flush();
  assert.equal(ui.calls.length, 1);
  const lock = JSON.parse(ui.window.localStorage.getItem(SUBMITTED_KEY));
  const candidate = ui.document.querySelector("#candidateId").textContent;
  assert.equal(lock.candidate, candidate);
  assert.equal(decodePayload(lock.code).c, candidate);

  const again = app({ draft: JSON.parse(ui.window.localStorage.getItem(KEY)), submitted: lock, unlocked: false }); t.after(again.close);
  assert.equal(again.document.querySelector("#candidateId").textContent, candidate);
  assert.equal(again.document.querySelector("#gateModal").hidden, true);
  assert.equal(again.document.querySelector("#submitModal").hidden, false);
  assert.equal(again.document.querySelector("#submitTitle").textContent, "Your response has been submitted.");
  assert.equal(again.document.querySelector("#submitBtn").hidden, true);
  assert.equal(again.document.body.classList.contains("readonly"), true);
  for (const timer of again.timers.filter(timer => timer.ms === 1000)) timer.callback();
  assert.equal(JSON.parse(again.window.localStorage.getItem(KEY)).activeSec, lock.activeSec || 0);
  assert.equal(again.errors.length, 0);
});

test("blocked local storage still opens the gate and calendar without startup exceptions", t => {
  const ui = app({ blockedStorage: true, unlocked: false }); t.after(ui.close);
  assert.equal(ui.document.querySelector("#gateModal").hidden, false);
  assert.equal(ui.document.querySelector("#storageNotice").hidden, false);
  assert(ui.document.querySelectorAll(".ev").length > 0);
  assert.equal(ui.errors.length, 0);
});

test("pagination appends responses while keeping the selected calendar", async t => {
  const ui = app({ review: true, fetch: async url => response(url.includes("cursor=") ?
    { ok: true, submissions: [serverPayload({ id: "11111111-1111-4111-8111-111111111111", c: "OLDERX", receivedAt: "2026-09-14T00:00:00Z" })], cursor: null } :
    { ok: true, submissions: [serverPayload()], cursor: "next-page" }) });
  t.after(ui.close); await flush();
  ui.document.querySelector("#subList .submission").click();
  assert.equal(ui.document.querySelector("#serverMore").hidden, false);
  ui.document.querySelector("#serverMore").click(); await flush();
  assert.equal(ui.document.querySelectorAll("#subList li").length, 2);
  assert.equal(ui.document.querySelector("#subList button.active b").textContent, "ABCDEF");
  assert.equal(ui.document.querySelector("#serverMore").hidden, true);
});

test("leaving review ignores a pending server response and preserves the candidate draft", async t => {
  let finish;
  const ui = app({ review: true, fetch: async () => new Promise(resolve => { finish = resolve; }) });
  t.after(ui.close);
  ui.document.querySelector("#exitReview").click();
  finish(response({ ok: true, submissions: [serverPayload()] })); await flush();
  assert.equal(ui.document.querySelector("#reviewSide").hidden, true);
  assert.equal(ui.document.querySelectorAll(".ev").length, 18);
  assert.equal(ui.document.querySelector("#submitBtn").hidden, false);
  assert.equal(JSON.parse(ui.window.localStorage.getItem(KEY)).events.length, 18);
});

test("cancelling reviewer login restores the start gate without starting the timer", t => {
  const ui = app({ review: true, unlocked: false, reviewerUnlocked: false }); t.after(ui.close);
  assert.equal(ui.document.querySelector("#pwModal").hidden, false);
  ui.document.querySelector("#pwCancel").click();
  assert.equal(ui.document.querySelector("#gateModal").hidden, false);
  for (const timer of ui.timers.filter(timer => timer.ms === 1000)) timer.callback();
  assert.equal(ui.document.querySelector("#timerText").textContent, "0:00");
  assert.equal(JSON.parse(ui.window.localStorage.getItem(KEY)).openedAt, null);
});

test("network failure keeps the lock, exposes a valid backup code, and allows a retry", async t => {
  let online = false;
  const ui = app({ fetch: async () => { if (!online) throw new Error("Offline"); return response({ ok: true, id: "01234567-89ab-4cde-8fab-0123456789ab" }, 201); } });
  t.after(ui.close);
  ui.document.querySelector("#submitBtn").click(); await flush();
  assert.equal(ui.document.querySelector("#submitCode").hidden, false);
  assert.equal(ui.document.querySelector("#copyCodeBtn").hidden, false);
  assert.equal(ui.document.querySelector("#retryBtn").hidden, false);
  assert.match(ui.document.querySelector("#submitCode").value, /^B1\./);
  assert.equal(ui.document.querySelector("#submitBtn").hidden, true);
  assert.equal(JSON.parse(ui.window.localStorage.getItem(SUBMITTED_KEY)).saved, false);
  online = true;
  ui.document.querySelector("#retryBtn").click(); await flush();
  assert.equal(ui.calls.length, 2);
  assert.equal(ui.calls[1].options.body, ui.calls[0].options.body);
  assert.equal(ui.document.querySelector("#submitTitle").textContent, "Your response has been submitted.");
  assert.equal(ui.document.querySelector("#retryBtn").hidden, true);
  assert.equal(JSON.parse(ui.window.localStorage.getItem(SUBMITTED_KEY)).saved, true);
});

test("reviewer dialog cancels pending checks and reopens without stale handlers", async t => {
  let finishDigest, checks = 0;
  const ui = app({ review: true, unlocked: false, reviewerUnlocked: false, digest: () => {
    checks++;
    return new Promise(resolve => { finishDigest = resolve; });
  } });
  t.after(ui.close);
  const input = ui.document.querySelector("#pwInput");
  const unlock = ui.document.querySelector("#pwUnlock");
  input.value = "cancelled-password";
  unlock.click();
  input.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(checks, 1);
  ui.document.querySelector("#pwCancel").click();
  finishDigest(Buffer.from(scenario.reviewerPasswordHash, "hex")); await flush();
  assert.equal(ui.document.querySelector("#reviewSide").hidden, true);
  assert.equal(ui.window.sessionStorage.getItem("cal-test:reviewer-ok"), null);
  assert.equal(ui.document.querySelector("#gateModal").hidden, false);

  ui.window.history.replaceState(null, "", "#review");
  ui.window.dispatchEvent(new ui.window.HashChangeEvent("hashchange"));
  ui.window.dispatchEvent(new ui.window.HashChangeEvent("hashchange"));
  input.value = "checked-password";
  unlock.click();
  input.value = "edited-while-waiting";
  assert.equal(checks, 2);
  finishDigest(Buffer.from(scenario.reviewerPasswordHash, "hex")); await flush();
  assert.equal(ui.document.querySelector("#reviewSide").hidden, false);
  assert.equal(ui.window.sessionStorage.getItem("cal-test:reviewer-pw"), "checked-password");
  assert.equal(ui.calls.filter(call => call.url === "/api/submissions").length, 1);
  unlock.click();
  assert.equal(checks, 2);
  assert.equal(ui.errors.length, 0);
});

test("successful gate unlock removes its click and keyboard handlers", async t => {
  let checks = 0;
  const ui = app({ unlocked: false, digest: async () => {
    checks++;
    return Buffer.from(scenario.openPasswordHash, "hex");
  } });
  t.after(ui.close);
  const input = ui.document.querySelector("#gateInput");
  const start = ui.document.querySelector("#gateStart");
  input.value = "synthetic-test-password";
  start.click(); await flush();
  assert.equal(ui.document.querySelector("#gateModal").hidden, true);
  assert.equal(ui.window.localStorage.getItem("cal-test:opened:" + scenario.name), "1");
  assert(JSON.parse(ui.window.localStorage.getItem(KEY)).openedAt);
  start.click();
  input.dispatchEvent(new ui.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  assert.equal(checks, 1);
  assert.equal(ui.errors.length, 0);
});

test("candidate search filters the loaded submission list without losing the selection", async t => {
  const submissions = [serverPayload(), serverPayload({ id: "11111111-1111-4111-8111-111111111111", c: "UVWXYZ", receivedAt: "2026-09-16T00:00:00Z" })];
  const ui = app({ review: true, fetch: async () => response({ ok: true, submissions, cursor: null }) }); t.after(ui.close); await flush();
  const search = ui.document.querySelector("#subSearch");
  ui.document.querySelectorAll("#subList .submission")[1].click();
  search.value = "abc"; search.dispatchEvent(new ui.window.Event("input"));
  assert.deepEqual([...ui.document.querySelectorAll("#subList b")].map(b => b.textContent), ["ABCDEF"]);
  assert.equal(ui.document.querySelector("#subEmpty").hidden, true);
  assert.match(ui.document.querySelector("#reviewBanner").textContent, /Candidate ABCDEF/);
  search.value = "zzz"; search.dispatchEvent(new ui.window.Event("input"));
  assert.equal(ui.document.querySelectorAll("#subList li").length, 0);
  assert.equal(ui.document.querySelector("#subEmpty").hidden, false);
  ui.document.querySelector("#serverRefresh").click(); await flush();
  assert.equal(ui.document.querySelectorAll("#subList li").length, 0);
  search.value = ""; search.dispatchEvent(new ui.window.Event("input"));
  assert.equal(ui.document.querySelectorAll("#subList li").length, 2);
  assert.equal(ui.document.querySelector("#subList button.active b").textContent, "ABCDEF");
  assert.equal(ui.errors.length, 0);
});

test("submission codes are pasted in a modal opened from the footer link", async t => {
  const ui = app({ review: true }); t.after(ui.close); await flush();
  const modal = ui.document.querySelector("#codeModal");
  assert.equal(modal.hidden, true);
  assert.equal(ui.document.querySelector("#reviewSide #reviewInput"), null);
  ui.document.querySelector("#reviewCodeOpen").click();
  assert.equal(modal.hidden, false);
  ui.document.querySelector("#reviewInput").value = "not a code";
  ui.document.querySelector("#reviewLoad").click();
  assert.equal(modal.hidden, false);
  assert.match(ui.document.querySelector("#reviewErr").textContent, /Could not read that code/);
  ui.document.querySelector("#reviewInput").value = encodePayload(payload());
  ui.document.querySelector("#reviewLoad").click();
  assert.equal(modal.hidden, true);
  assert.equal(ui.document.querySelector("#reviewInput").value, "");
  assert.match(ui.document.querySelector("#reviewBanner").textContent, /Candidate ABCDEF/);
  ui.document.querySelector("#reviewCodeOpen").click();
  ui.document.querySelector("#reviewCodeCancel").click();
  assert.equal(modal.hidden, true);
  assert.equal(ui.errors.length, 0);
});

const sampleTest = (overrides = {}) => ({ slug: "ops-round-2", title: "Ops round 2", password: "fall-2026", revision: 3, events: [{ id: "t1", title: "Kickoff", date: "2026-09-15", start: 600, end: 660, color: "green", detail: "Recurring" }], ...overrides });
const testFetch = (handlers) => async (url, options = {}) => {
  const method = options.method || "GET";
  for (const [pattern, handler] of handlers) if (pattern.test(method + " " + url)) return handler(url, options);
  return response({ ok: true, submissions: [], cursor: null });
};

test("the start gate activates a reviewer-created test by its password and keeps it for this browser", async t => {
  const opens = [];
  const ui = app({ unlocked: false, fetch: testFetch([[/POST \/api\/open$/, (url, options) => {
    opens.push(JSON.parse(options.body).password);
    const { password, ...safe } = sampleTest();
    return opens.at(-1) === password ? response({ ok: true, test: safe }) : response({ ok: false, error: "That password is not correct." }, 404);
  }]]) });
  t.after(ui.close);
  assert.equal(ui.document.querySelector("#gateModal").hidden, false);
  const input = ui.document.querySelector("#gateInput"), start = ui.document.querySelector("#gateStart");
  input.value = "wrong-password"; start.click(); await flush();
  assert.equal(ui.document.querySelector("#gateErr").hidden, false);
  assert.equal(ui.document.querySelector("#gateErr").textContent, "That password is not correct.");
  assert.equal(ui.window.localStorage.getItem("cal-test:test"), null);
  input.value = "fall-2026"; start.click(); await flush();
  assert.deepEqual(opens, ["wrong-password", "fall-2026"]);
  const stored = JSON.parse(ui.window.localStorage.getItem("cal-test:test"));
  assert.equal(stored.slug, "ops-round-2"); assert.equal(stored.revision, 3); assert.equal(stored.password, "");
  assert.equal(ui.navigations.length, 1);
  assert.equal(ui.window.localStorage.getItem("cal-test:opened:" + scenario.name), null);

  const again = app({ unlocked: false, storage: { "cal-test:test": JSON.stringify(stored) } }); t.after(again.close);
  assert.equal(again.document.querySelector("#gateModal").hidden, true);
  assert.equal(again.document.querySelectorAll(".ev").length, 1);
  assert.equal(again.document.querySelector(".ev .t").textContent, "Kickoff");
  assert.match(again.document.querySelector(".ev").title, /Recurring/);
  assert.equal(again.window.localStorage.getItem(KEY), null);
  const draft = JSON.parse(again.window.localStorage.getItem("cal-test:Ops round 2 (rev 3)"));
  assert.equal(draft.events.length, 1); assert(draft.openedAt);
  again.document.querySelector("#submitBtn").click(); await flush();
  assert.equal(JSON.parse(again.calls.at(-1).options.body).s, "Ops round 2 (rev 3)");
  assert.equal(again.errors.length, 0);
});

test("the default scenario password still opens the scenario.js calendar without touching the server", async t => {
  const ui = app({ unlocked: false, digest: async () => Buffer.from(scenario.openPasswordHash, "hex") }); t.after(ui.close);
  ui.document.querySelector("#gateInput").value = "default-password";
  ui.document.querySelector("#gateStart").click(); await flush();
  assert.equal(ui.document.querySelector("#gateModal").hidden, true);
  assert.equal(ui.calls.length, 0);
  assert.equal(ui.window.localStorage.getItem("cal-test:test"), null);
  assert.equal(ui.document.querySelectorAll(".ev").length, 18);
});

test("a reviewer link opens a test with the reviewer password and reports one that cannot be opened", async t => {
  const ui = app({ search: "?test=ops-round-2", review: true, fetch: testFetch([
    [/GET \/api\/tests\?slug=ops-round-2$/, () => response({ ok: true, test: sampleTest() })],
    [/GET \/api\/tests$/, () => response({ ok: true, tests: [{ slug: "ops-round-2", title: "Ops round 2", password: "fall-2026" }] })],
  ]) });
  t.after(ui.close); await flush();
  assert.equal(ui.calls[0].url, "/api/tests?slug=ops-round-2");
  assert.equal(ui.calls[0].options.headers["X-Reviewer-Password"], "test-reviewer-password");
  assert.equal(ui.document.querySelectorAll(".ev").length, 1);
  assert.match(ui.document.querySelector("#testCurrent").textContent, /Ops round 2 .* "fall-2026"/);
  assert.equal(ui.document.querySelector("#testTools").hidden, false);
  assert.deepEqual([...ui.document.querySelectorAll("#testList a")].map(a => [a.textContent, a.getAttribute("href")]),
    [[`Default (${scenario.name}) \u00b7 scenario.js password`, "/#review"], ["Ops round 2 \u00b7 fall-2026", "/?test=ops-round-2#review"]]);
  assert.equal(ui.document.querySelector("#testList a.active").getAttribute("href"), "/?test=ops-round-2#review");
  assert.equal(ui.window.localStorage.getItem("cal-test:test"), null);

  const missing = app({ search: "?test=missing", review: true, fetch: testFetch([
    [/GET \/api\/tests\?slug=/, () => response({ ok: false, error: "Test not found" }, 404)],
    [/GET \/api\/tests$/, () => response({ ok: true, tests: [] })],
  ]) });
  t.after(missing.close); await flush();
  assert.equal(missing.document.querySelector("#reviewSide").hidden, false);
  assert.match(missing.document.querySelector("#testErr").textContent, /Could not open that test: Test not found/);
  assert.equal(missing.document.querySelectorAll(".ev").length, 18);
  assert.equal(missing.errors.length, 0);

  // Without a reviewer session the link falls back to the default calendar until the password is entered.
  const locked = app({ search: "?test=ops-round-2", review: true, reviewerUnlocked: false, fetch: testFetch([]) }); t.after(locked.close);
  assert.equal(locked.calls.length, 0);
  assert.equal(locked.document.querySelector("#pwModal").hidden, false);
});

test("reviewers create a test by title and password, land in an empty calendar, edit it, and save", async t => {
  const created = [];
  const ui = app({ review: true, fetch: testFetch([
    [/GET \/api\/tests$/, () => response({ ok: true, tests: [] })],
    [/POST \/api\/tests$/, (url, options) => { created.push(JSON.parse(options.body)); return response({ ok: true, test: { slug: "new-test", title: "New test", password: "go", revision: 1, events: [] } }, 201); }],
  ]) });
  t.after(ui.close); await flush();
  assert.equal(ui.document.querySelector("#testTools").hidden, true);
  const submitCreate = () => ui.document.querySelector("#testCreate").dispatchEvent(new ui.window.Event("submit", { cancelable: true }));
  ui.document.querySelector("#testTitle").value = "!!!"; ui.document.querySelector("#testPasswordNew").value = "go";
  submitCreate();
  assert.match(ui.document.querySelector("#testErr").textContent, /letters or numbers/);
  ui.document.querySelector("#testTitle").value = "New test"; ui.document.querySelector("#testPasswordNew").value = " ";
  submitCreate();
  assert.match(ui.document.querySelector("#testErr").textContent, /activation password/);
  assert.equal(created.length, 0);
  ui.document.querySelector("#testPasswordNew").value = "go";
  submitCreate(); await flush();
  assert.deepEqual(created, [{ title: "New test", password: "go" }]);
  assert.equal(ui.calls.at(-1).options.headers["X-Reviewer-Password"], "test-reviewer-password");
  assert.equal(ui.navigations.length, 1);

  const saved = [];
  const editor = app({ search: "?test=new-test#edit", fetch: testFetch([
    [/GET \/api\/tests\?slug=new-test$/, () => response({ ok: true, test: { slug: "new-test", title: "New test", password: "go", revision: 1, events: [] } })],
    [/GET \/api\/tests$/, () => response({ ok: true, tests: [{ slug: "new-test", title: "New test", password: "go" }] })],
    [/PUT \/api\/tests\?slug=new-test$/, (url, options) => { saved.push(JSON.parse(options.body)); return response({ ok: true, test: {} }); }],
  ]) });
  t.after(editor.close); await flush();
  assert.equal(editor.document.querySelector("#reviewSide").hidden, false);
  assert.equal(editor.document.querySelector("#testBuildTools").hidden, false);
  assert.equal(editor.document.body.classList.contains("readonly"), false);
  assert.equal(editor.window.location.hash, "#review");
  assert.match(editor.document.querySelector("#reviewBanner").textContent, /Editing starting calendar/);
  assert.equal(editor.document.querySelectorAll(".ev").length, 0);
  assert.equal(editor.document.querySelector('#dayNotes textarea[data-date="2026-09-14"]').disabled, true);

  const column = editor.document.querySelector('.daycol[data-date="2026-09-16"]');
  column.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 528, width: 100, height: 528 });
  editor.document.querySelector(".daycol").getBoundingClientRect = column.getBoundingClientRect;
  column.dispatchEvent(new editor.window.MouseEvent("pointerdown", { button: 0, clientX: 50, clientY: 96, bubbles: true }));
  editor.window.dispatchEvent(new editor.window.MouseEvent("pointerup", { clientX: 50, clientY: 96, bubbles: true }));
  assert.equal(editor.document.querySelector("#popup").hidden, false);
  assert.equal(editor.document.querySelector("#popNotesLabel").textContent, "Details shown under the event (optional)");
  editor.document.querySelector("#popTitle").value = "Standup";
  editor.document.querySelector("#popNotes").value = "Daily";
  editor.document.querySelector("#popSave").click();
  assert.equal(editor.document.querySelectorAll('.daycol[data-date="2026-09-16"] .ev').length, 1);
  assert.equal(JSON.parse(editor.window.localStorage.getItem("cal-test:New test (rev 1)")).events.length, 0);

  editor.document.querySelector("#testSave").click(); await flush();
  assert.deepEqual(saved.map(body => Object.keys(body)), [["title", "events"]]);
  assert.deepEqual(Object.keys(saved[0].events[0]).sort(), ["color", "date", "detail", "end", "id", "start", "title"]);
  assert.equal(saved[0].events[0].title, "Standup"); assert.equal(saved[0].events[0].detail, "Daily"); assert.equal(saved[0].events[0].date, "2026-09-16");
  // The new revision is part of the scenario name, so the page reloads to pick it up.
  assert.equal(editor.navigations.length, 1);
  assert.equal(editor.window.sessionStorage.getItem("cal-test:toast"), "Starting calendar saved");
  assert.equal(editor.errors.length, 0);

  const reloaded = app({ search: "?test=new-test", review: true, fetch: testFetch([
    [/GET \/api\/tests\?slug=new-test$/, () => response({ ok: true, test: { slug: "new-test", password: "go", revision: 2, ...saved[0] } })],
    [/GET \/api\/tests$/, () => response({ ok: true, tests: [{ slug: "new-test", title: "New test", password: "go" }] })],
    [/PUT \/api\/tests\?slug=new-test$/, (url, options) => { saved.push(JSON.parse(options.body)); return response({ ok: true, test: {} }); }],
  ]) });
  t.after(reloaded.close);
  reloaded.window.sessionStorage.setItem("cal-test:toast", "Starting calendar saved"); await flush();
  assert.equal(reloaded.document.querySelector("#toast").textContent, "Starting calendar saved");
  assert.equal(reloaded.window.sessionStorage.getItem("cal-test:toast"), null);
  assert.equal(reloaded.document.querySelectorAll(".ev").length, 1);
  assert.equal(reloaded.document.querySelector("#testBuildTools").hidden, true);
  assert.equal(reloaded.document.querySelector("#testTools").hidden, false);
  assert.equal(reloaded.document.querySelector("#testList a.active").textContent, "New test \u00b7 go");
  reloaded.document.querySelector("#testPasswordInput").value = "go-2";
  reloaded.document.querySelector("#testPassword").dispatchEvent(new reloaded.window.Event("submit", { cancelable: true })); await flush();
  assert.deepEqual(saved.at(-1), { password: "go-2" });
  assert.equal(reloaded.window.sessionStorage.getItem("cal-test:toast"), "Activation password saved");
  assert.equal(reloaded.navigations.length, 1);
  assert.equal(reloaded.errors.length, 0);
});
