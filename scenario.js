/* exported SCENARIO */
/* ============================================================
   SCENARIO — edit this block between hiring rounds.
   - today:        the date the calendar opens on (the "today" badge).
   - timezone:     label shown in the time gutter. Display only.
   - dayStart/dayEnd: the visible hours. The grid is scaled so this
                   range fills the window; nothing outside it is shown.
   - instructions: shown to the candidate behind the "Instructions"
                   button. Set to "" to hide the button.
   - apiBase:      where the backend lives. "" means the same site
                   (the Vercel deployment with the /api folder). Set a
                   full origin like "https://your-app.vercel.app" if
                   this page is hosted somewhere else. The backend
                   needs two things on Vercel: a Blob store connected
                   to the project, and a REVIEWER_PASSWORD
                   environment variable (see README).
   - reviewerPasswordHash: SHA-256 of the password that unlocks the
                   reviewer view (#review). To change it, run in a terminal:
                     printf '%s' 'your-new-password' | shasum -a 256
                   and paste the hash here. Set to "" for no password.
   - openPasswordHash: SHA-256 of the password a candidate must enter
                   before the test opens (so nobody starts it by accident).
                   Same recipe as above. Set to "" for no gate.
   - events:       the starting calendar. Give every event a stable
                   id so the reviewer view can tell moved/deleted
                   events from new ones. Times are 24h "HH:MM".
                   color: blue | green | purple | red | orange | gray
                   location / detail: optional, shown as a third line
                   at the bottom of the event block (not editable).
                   The scenario name is also the storage key: change
                   it whenever you change the events so returning
                   browsers start fresh.
   ============================================================ */
const SCENARIO = {
  name: "Scheduling test v3",
  today: "2026-09-14",
  timezone: "PDT",
  dayStart: "08:00",
  dayEnd: "19:00",
  apiBase: "",
  reviewerPasswordHash: "0a90d385aef07a5fd74c59c60ec803f554009f6ec0b88607d614b3f0e39dff2d",
  openPasswordHash: "914916a6aa168a890b6752c7510d6837a51311a15999a5e15fa63d8a5934b6ac",
  instructions:
    "Review the calendar and complete the scheduling task you were given. " +
    "When you are done, click Submit and send us the code it gives you.",
  events: [
    { id: "mon1", title: "Policy team weekly",            date: "2026-09-14", start: "09:00", end: "10:00" },
    { id: "mon2", title: "Lunch w/ Nate (interim COO)",   date: "2026-09-14", start: "12:00", end: "13:00" },
    { id: "mon3", title: "1:1 Leon",                      date: "2026-09-14", start: "15:00", end: "15:30" },
    { id: "mon4", title: "Focus block",                   date: "2026-09-14", start: "16:00", end: "18:00" },
    { id: "tue1", title: "Policy team weekly",            date: "2026-09-15", start: "09:00", end: "10:00" },
    { id: "tue2", title: "Lunch w/ Nate (interim COO)",   date: "2026-09-15", start: "12:00", end: "13:00" },
    { id: "tue3", title: "1:1 Leon",                      date: "2026-09-15", start: "15:00", end: "15:30" },
    { id: "tue4", title: "Focus block",                   date: "2026-09-15", start: "16:00", end: "18:00" },
    { id: "wed1", title: "Leadership meeting",            date: "2026-09-16", start: "09:30", end: "11:00" },
    { id: "wed2", title: "Board deck prep w/ Beth",       date: "2026-09-16", start: "11:00", end: "12:00" },
    { id: "wed3", title: "Interview \u2014 Priya Raman (Anthropic), Policy Analyst", date: "2026-09-16", start: "14:00", end: "15:00" },
    { id: "wed4", title: "Coaching w/ Ben",               date: "2026-09-16", start: "16:00", end: "17:00", detail: "Recurring, every other week" },
    { id: "thu1", title: "All hands",                     date: "2026-09-17", start: "10:00", end: "11:00" },
    { id: "thu2", title: "Ethan",                         date: "2026-09-17", start: "10:30", end: "11:00" },
    { id: "thu3", title: "Lunch w/ Sami",                 date: "2026-09-17", start: "12:30", end: "13:30", location: "Berkeley" },
    { id: "thu4", title: "Talk at OrgZ",                  date: "2026-09-17", start: "14:00", end: "15:00", location: "SF Mission District" },
    { id: "fri1", title: "1:1 Lawrence",                  date: "2026-09-18", start: "09:00", end: "09:30", detail: "4th scheduled slot; moved 3 times" },
    { id: "fri2", title: "Weekly check-in w/ [you]",      date: "2026-09-18", start: "11:00", end: "11:30" }
  ]
};
