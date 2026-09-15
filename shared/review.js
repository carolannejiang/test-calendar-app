(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarReview = api;
})(globalThis, function () {
  "use strict";
  const submissionKey = p => p.id || `backup:${p.c}:${p.t}`;
  const sortSubmissions = submissions => [...submissions].sort((a, b) =>
    Date.parse(b.receivedAt || b.t) - Date.parse(a.receivedAt || a.t) || submissionKey(a).localeCompare(submissionKey(b)));
  const sameResponse = (a, b) => a.c === b.c && a.t === b.t && a.s === b.s &&
    JSON.stringify(a.e) === JSON.stringify(b.e) && JSON.stringify(a.d) === JSON.stringify(b.d) && a.a === b.a && a.o === b.o;

  function mergeSubmissions(current, incoming, { replaceServer = false } = {}) {
    const result = current.filter(p => !replaceServer || !p._server);
    for (const p of incoming) {
      const index = result.findIndex(q => submissionKey(q) === submissionKey(p) || ((!q.id || !p.id) && sameResponse(q, p)));
      if (index < 0) result.push(p);
      else if (p._server || !result[index]._server) result[index] = p;
    }
    return sortSubmissions(result);
  }
  return { submissionKey, sameResponse, sortSubmissions, mergeSubmissions };
});
