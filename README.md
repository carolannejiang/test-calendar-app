# test-calendar-app

A Google Calendar–style week view used to administer scheduling work tests during hiring.

Candidates open the page, follow the instructions, edit the calendar (create, move, resize, delete events), write their reasoning, and click **Submit**. The submission is saved to the backend automatically, and the page also shows a backup code the candidate can send if saving fails. Reviewers open the **reviewer view**, enter the reviewer password, and see every submission: the calendar, a list of changes from the starting scenario, per-day notes, and time spent.

Live: https://test-calendar-app.vercel.app · Reviewer view: https://test-calendar-app.vercel.app/#review

## Layout

- `index.html` — the whole front end. Edit the `SCENARIO` block at the top to change the date, hours, instructions, starting events, and reviewer password hash.
- `api/submit.js` — `POST /api/submit`, stores a candidate submission.
- `api/submissions.js` — `GET /api/submissions` (list) and `DELETE /api/submissions?id=` (remove), both require the reviewer password.
- `api/_store.js` — shared Redis and auth helpers.

## One-time backend setup on Vercel

1. **Storage.** In the Vercel dashboard open the project → **Storage** → **Create Database** → choose **Upstash for Redis** (Marketplace) → free plan → connect it to this project. This adds the `KV_REST_API_URL` and `KV_REST_API_TOKEN` environment variables.
2. **Reviewer password.** Project → **Settings** → **Environment Variables** → add `REVIEWER_PASSWORD` for Production (and Preview if you use preview deployments). Use the same password whose SHA-256 hash is in `reviewerPasswordHash` in `index.html`. To make a new hash:
   ```bash
   printf '%s' 'your-new-password' | shasum -a 256
   ```
3. **Redeploy** (Deployments → ⋯ → Redeploy) so the functions pick up the new variables.

Until step 1 is done, Submit falls back to showing the backup code and the reviewer view says storage is not configured.

## Reviewing

Open `/#review`, enter the reviewer password. Submissions load from the server automatically (Refresh to re-check). Click one to see the candidate's calendar: moved events are yellow, deleted ones grey and struck through. The ✕ on a server submission deletes it permanently. You can also paste a backup code into the box to load it.

## Notes

- No build step. Vercel serves `index.html` as a static page and the `api/` files as serverless functions.
- Candidate progress (events, notes, timer) is saved in their browser, so a reload does not lose work.
- Change the `name` in `SCENARIO` whenever you change the starting events, so returning browsers start fresh.
