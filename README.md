# test-calendar-app

A Google Calendar–style week view used to administer scheduling work tests during hiring.

Candidates open the page, follow the instructions, edit the calendar (create, move, resize, delete events), write their reasoning, and click **Submit**. The submission is saved to the backend automatically, and the page also shows a backup code the candidate can send if saving fails. Reviewers open the **reviewer view**, enter the reviewer password, and see every submission: the calendar, a list of changes from the starting scenario, per-day notes, and time spent.

Live: https://test-calendar-app.vercel.app · Reviewer view: https://test-calendar-app.vercel.app/#review

## Layout

- `index.html` — the whole front end. Edit the `SCENARIO` block at the top to change the date, hours, instructions, starting events, and reviewer password hash.
- `api/submit.js` — `POST /api/submit`, stores a candidate submission.
- `api/submissions.js` — `GET /api/submissions` (list) and `DELETE /api/submissions?id=` (remove), both require the reviewer password.
- `api/_store.js` — shared Blob storage and auth helpers.

## Backend on Vercel

Submissions are stored in a private **Vercel Blob** store (included in the Vercel plan, no add-on). Two environment variables make it work, both already set on the project:

- `BLOB_READ_WRITE_TOKEN` — created automatically when the Blob store was connected to the project.
- `REVIEWER_PASSWORD` — the reviewer password. Must match the password whose SHA-256 hash is in `reviewerPasswordHash` in `index.html` (the password itself is not stored in this repo). To change it: set the new value in Vercel (Settings → Environment Variables), put the new hash in `index.html`, and redeploy. To make a hash:
  ```bash
  printf '%s' 'your-new-password' | shasum -a 256
  ```

If either variable is missing, Submit falls back to showing the backup code and the reviewer view says so.

## Reviewing

Open `/#review`, enter the reviewer password. Submissions load from the server automatically (Refresh to re-check). Click one to see the candidate's calendar: moved events are yellow, deleted ones grey and struck through. The ✕ on a server submission deletes it permanently. You can also paste a backup code into the box to load it.

## Notes

- No build step. Vercel serves `index.html` as a static page and the `api/` files as serverless functions (`package.json` pulls in `@vercel/blob`).
- Candidate progress (events, notes, timer) is saved in their browser, so a reload does not lose work.
- Change the `name` in `SCENARIO` whenever you change the starting events, so returning browsers start fresh.
