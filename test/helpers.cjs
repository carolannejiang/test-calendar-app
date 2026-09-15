const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { webcrypto } = require("node:crypto");
const { JSDOM, VirtualConsole } = require("jsdom");
const root = path.join(__dirname, "..");
const scenarioSource = fs.readFileSync(path.join(root, "scenario.js"), "utf8");
const scenario = vm.runInNewContext(scenarioSource + "\nSCENARIO");
const KEY = "cal-test:" + scenario.name;
const SUBMITTED_KEY = "cal-test:submitted:" + scenario.name;
const event = (overrides = {}) => ({ id: "mon1", title: "Meeting", date: "2026-09-14", start: 540, end: 600, allDay: false, color: "blue", notes: "", deleted: false, ...overrides });
const payload = (overrides = {}) => ({ v: 1, c: "ABCDEF", s: scenario.name, t: "2026-09-15T10:00:00.000Z", o: null, a: 0, d: {}, e: [["mon1", "Meeting", "2026-09-14", 540, 600, 0, "blue", "", 0]], ...overrides });
const serverPayload = (overrides = {}) => ({ ...payload(), id: "01234567-89ab-4cde-8fab-0123456789ab", receivedAt: "2026-09-15T10:00:00.000Z", ...overrides });
const flush = () => new Promise(resolve => setImmediate(resolve));

function app({ review = false, fetch, draft, submitted, blockedStorage = false, unlocked = true, reviewerUnlocked = true } = {}) {
  const errors = [], calls = [], alerts = [], timers = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", error => errors.push(error));
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "");
  const dom = new JSDOM(html, { url: "https://calendar-test.invalid/" + (review ? "#review" : ""), runScripts: "outside-only", virtualConsole });
  const window = dom.window;
  window.TextEncoder = TextEncoder; window.TextDecoder = TextDecoder;
  Object.defineProperty(window.crypto, "subtle", { value: webcrypto.subtle });
  if (unlocked) window.localStorage.setItem("cal-test:opened:" + scenario.name, "1");
  if (draft) window.localStorage.setItem(KEY, JSON.stringify(draft));
  if (submitted) window.localStorage.setItem(SUBMITTED_KEY, JSON.stringify(submitted));
  if (reviewerUnlocked) window.sessionStorage.setItem("cal-test:reviewer-ok", scenario.reviewerPasswordHash);
  window.sessionStorage.setItem("cal-test:reviewer-pw", "test-reviewer-password");
  if (blockedStorage) Object.defineProperty(window, "localStorage", { get() { throw new Error("Storage blocked"); } });
  window.setInterval = (callback, ms) => { timers.push({ callback, ms }); return timers.length; };
  window.confirm = () => true;
  window.alert = text => alerts.push(text);
  window.fetch = async (url, options) => {
    calls.push({ url, options });
    if (fetch) return fetch(url, options);
    return response({ ok: true, submissions: [], cursor: null });
  };
  const scripts = ["scenario.js", "shared/submission.js", "shared/calendar.js", "shared/review.js", "shared/storage.js", "app.js"];
  window.eval(scripts.map(file => fs.readFileSync(path.join(root, file), "utf8")).join("\n"));
  return { window, document: window.document, errors, calls, alerts, timers, close: () => window.close() };
}
function response(body, status = 200) { return { ok: status >= 200 && status < 300, status, json: async () => body }; }
module.exports = { app, response, flush, event, payload, serverPayload, scenario, KEY, SUBMITTED_KEY };
