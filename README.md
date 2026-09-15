# test-calendar-app

A Google Calendar–style week view used to administer scheduling work tests during hiring.

Candidates open the page, follow the instructions, edit the calendar (create, move, resize, delete events), and click **Submit**. The page produces a code containing their anonymous candidate ID and final calendar. Reviewers paste that code into the **Reviewer** view to see the calendar and a list of changes from the starting scenario.

## Usage

- Open `index.html` in a browser, or host it anywhere static (e.g. GitHub Pages).
- Edit the `SCENARIO` block at the top of `index.html` to change the date, timezone, instructions, and starting events.
- Reviewer view: open the page with `#review` added to the URL. Candidates see no reviewer controls.

No build step, no backend. Progress is saved in the candidate's browser.
