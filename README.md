# test-calendar-app

A Google Calendar–style week view used to administer scheduling work tests during hiring.

Candidates enter the activation password they were given, edit the starting calendar it opens, write their reasoning, and click **Submit**. Responses are saved to a private backend. If saving fails, the page provides a backup code that contains the response and a retry button. Once Submit is confirmed, the response is locked for that candidate ID: the calendar becomes read-only, the page shows "Your response has been submitted", and this persists across reloads in the same browser. Reviewers enter their password to browse submissions, changes, notes, and reported time spent.

Live: https://test-calendar-app.vercel.app · Reviewer view: https://test-calendar-app.vercel.app/?review (or /#review)

## Local development and checks

Use Node.js 24.15 or later in the 24.x line.

```bash
npm ci
npm run check
```

`npm run check` runs ESLint and the Node regression tests. The tests use an isolated DOM and mocked Blob storage; they do not access production data. They cover payload validation, backup-code compatibility, overlapping events, reviewer refresh/delete races, pagination, authentication, and browser storage failures.

For a frontend-only preview, serve the directory over HTTP, for example:

```bash
python3 -m http.server 8000
```

Open http://localhost:8000. This static server has no API, so Submit provides a backup code. To exercise the serverless functions locally, use Vercel's development server with a **separate development Blob store** and development environment variables.

There is no build step. HTML, CSS, and JavaScript are served directly. `scenario.js` defaults `apiBase` to `""`, so API calls stay on the current origin. A cross-origin backend is an explicit opt-in for installations that serve the frontend separately; local and preview deployments should use their own backend configuration.

## Layout

- `index.html` — accessible page and modal markup.
- `styles.css` — calendar layout and system light/dark theme.
- `scenario.js` — scenario name, date, visible hours, instructions, starting events, and password hashes.
- `app.js` — calendar interactions, candidate progress, and reviewer UI.
- `shared/submission.js` — shared payload validation, named event packing/unpacking, and C1/B1 backup codecs.
- `shared/test.js` — reviewer-created test records: title, activation password, revision, and starting events.
- `shared/calendar.js` — date formatting, overlap layout, and change descriptions that reuse the starting calendar's ID lookup.
- `shared/review.js` — stable submission identity, ordering, and cache reconciliation.
- `shared/storage.js` — guarded browser storage with a memory fallback.
- `shared/notes.js` — reusable bullet-list editing for note fields, including listener cleanup.
- `api/submit.js` — `POST /api/submit`, validates and creates an immutable response.
- `api/submissions.js` — authenticated `GET /api/submissions?cursor=…` and `DELETE /api/submissions?id=…`.
- `api/tests.js` — authenticated `GET`, `POST`, and `PUT /api/tests` for reviewer-created tests.
- `api/open.js` — `POST /api/open`, exchanges an activation password for that test's starting calendar.
- `api/_store.js` — private Blob access, pagination, and reviewer authentication.
- `test/` — application, API, and shared-logic regression tests.

## Backend on Vercel

Configure these environment variables separately for production, previews, and development:

- `BLOB_READ_WRITE_TOKEN` — token for the environment's private Vercel Blob store.
- `REVIEWER_PASSWORD` — the reviewer password. Its SHA-256 hash must match `reviewerPasswordHash` in `scenario.js`.

To change the reviewer password, update the environment variable and frontend hash, then redeploy. Generate a hash with:

```bash
printf '%s' 'your-new-password' | shasum -a 256
```

The backend generates a UUID and `receivedAt` for each accepted response. Clients cannot choose a storage ID, overwrite an existing response, or supply server provenance. Candidate timestamps are retained for backup matching and reported duration; server receipt/upload times determine server ordering. Timing values supplied by candidates are informational, not independently verified measurements.

Listing downloads at most 50 response bodies per request, with at most eight concurrent reads. It scans lightweight Blob metadata to identify the newest page. The returned cursor uses the last record's upload time and path, so deleting that record does not invalidate pagination. Invalid historical records are skipped and counted in the reviewer status.

## Reviewing and compatibility

Open `/#review` and enter the reviewer password. The newest page loads automatically; **Load more submissions** retrieves older responses. **Refresh** reloads the newest page and reconciles cached server records. The selected response is tracked by ID; if it is no longer in the refreshed page, the starting calendar is shown. Locally imported backup codes are retained.

The ✕ next to a server response permanently deletes that response. The corresponding control on an imported code only removes it from the local list. Both UUIDs and legacy candidate/timestamp IDs remain supported for deletion.

Existing C1 and B1 codes and their v1 event tuple positions remain readable, including the legacy all-day field. Candidate editing remains limited to timed events within the scenario week. Reviewers can navigate weeks and inspect legacy all-day responses.

Change comparisons are only shown when a response's scenario name matches this installation's scenario. For other scenarios, the reviewer sees the submitted calendar and notes with a notice that the original starting calendar is unavailable. No changes are inferred from an unrelated starting calendar.

## Reviewer-created tests

Reviewers can add tests without editing `scenario.js`. In the reviewer view, the **Tests** panel lists every test with its activation password. Enter a title and an activation password and click **Create** to open an empty calendar in editing mode; click or drag on the grid to add starting events (the popup's notes field becomes the detail line shown under the event), then click **Save starting calendar**. **Edit starting calendar** reopens that mode for an existing test, and the **Change** field replaces its activation password.

Candidates need only the site URL: the start gate sends the password they enter to `POST /api/open`, and the matching test replaces the `scenario.js` calendar in that browser until `#reset`. The `scenario.js` password still opens the default scenario. Reviewer-created tests share the default scenario's week, visible hours, timezone, and instructions.

Tests are stored as `tests/<slug>.json` in the private Blob store, where the slug is derived from the title (and must be unique, as must the activation password). The slug also appears in reviewer links such as `/?test=<slug>#review`, which require the reviewer password; it never grants candidates access. Each time a starting calendar is saved with different events the test's revision increases. The revision is part of the scenario name (`Title (rev N)`), so drafts, submission locks, and change comparisons are always tied to the calendar the candidate actually started from; submissions made against an older revision show as a different scenario. Changing only the password keeps the revision.

## Changing scenarios and candidate progress

Edit `scenario.js`. **Change the scenario name whenever starting events, dates, or hours change**, so old browser drafts are not reused and historical submissions are not compared against a changed baseline. Keep a copy of the previous scenario configuration if you need its original change comparisons later.

Candidate progress is saved in browser storage. When storage is blocked or full, the app continues in memory and tells the candidate to keep the page open until submitting. Closing that page cannot preserve an in-memory draft.

The submission lock is also stored per scenario name, so changing the scenario unlocks returning browsers with a fresh candidate ID. Opening the page with `#reset` clears the draft, the start gate, the lock, and any activated reviewer-created test, which issues a new candidate ID.
