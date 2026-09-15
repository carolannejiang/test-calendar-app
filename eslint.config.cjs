const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  { ignores: ["node_modules/**", ".context/**"] },
  js.configs.recommended,
  {
    files: ["**/*.js", "**/*.cjs"],
    languageOptions: { globals: globals.node },
    rules: { "no-empty": ["error", { allowEmptyCatch: true }], "no-unused-vars": ["error", { caughtErrors: "none" }] },
  },
  {
    files: ["app.js", "scenario.js", "shared/*.js"],
    languageOptions: {
      sourceType: "script",
      globals: { ...globals.browser, CalendarCore: "readonly", CalendarSubmission: "readonly", CalendarReview: "readonly", CalendarStorage: "readonly", CalendarNotes: "readonly", CalendarTest: "readonly" },
    },
  },
  { files: ["app.js"], languageOptions: { globals: { SCENARIO: "readonly" } } },
];
