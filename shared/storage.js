(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.CalendarStorage = api;
})(globalThis, function () {
  // Memory fallback keeps the current session usable when browser storage is blocked.
  function createStorage(getStorage, onFailure = () => {}) {
    const memory = new Map();
    return {
      get(key) {
        if (memory.has(key)) return memory.get(key);
        try { return getStorage().getItem(key); }
        catch { onFailure(); return null; }
      },
      set(key, value) {
        memory.set(key, String(value));
        try { getStorage().setItem(key, String(value)); }
        catch { onFailure(); }
      },
      remove(key) {
        memory.set(key, null);
        try { getStorage().removeItem(key); }
        catch { onFailure(); }
      },
    };
  }
  return { createStorage };
});
