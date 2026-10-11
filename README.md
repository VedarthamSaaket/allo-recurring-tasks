# Recurring Task Automation (Google Sheets + Apps Script)

A complete recurring-task workflow built on a Google Sheet. Employees see their
pending work in one place and submit completion; a time-driven Apps Script engine
tracks deadlines, records proof, and escalates missed work to managers and
leadership by email.

The automation source is `Automation.gs`, a bound Google Apps Script. The
workbook it is bound to is `Recurring_Tasks.xlsx` (exported copy).

## What it does

- **Task Master** defines each recurring task — daily, 7, 15 or 30-day — with its
  assignee, due time, required proof and active flag.
- The engine creates **one cycle per task per due date** and keeps unfinished
  cycles visible until they are completed.
- Employees work in **Employee Tasks**, submit proof in a single place, and the
  completion time and accepted proof are recorded automatically.
- A **time-based trigger** runs every N minutes, marks overdue work, and queues
  manager / leadership alerts.
- **Manager Review** shows pending and overdue counts per employee plus a live
  overdue list.
- **Completion History** keeps an immutable record of accepted proof.
- Email mode defaults to **DRY_RUN** (simulated), so nothing is sent until it is
  switched to **LIVE**.

## How it works

The design separates a pure engine from the sheet and email adapters:

- `advance(state, now, settings)` — deterministic. Computes statuses, creates or
  backfills cycles, queues and cancels alerts. All times use explicit offsets and
  the `Asia/Kolkata` time zone.
- `processTasks()` — the trigger entry point. Takes a document lock, reads sheet
  state, advances the engine, persists rows, delivers email, and syncs
  permissions.
- `deliver_(state, settings, now)` — `DRY_RUN` records a simulated send; `LIVE`
  calls `MailApp.sendEmail`. The row is persisted *before* sending, so an
  uncertain send stays `SENDING` and is never auto-resent.
- `protectInputs_()` / `syncEmployeePermissions_()` — per-row range protection so
  an employee can only edit their own proof and submit cells.
- `runCoreTests()` / `runDemoTests()` — a shared test suite that runs inside the
  sheet against the same engine used in production.

## Recurrence and SLA rules

- Daily tasks run Monday to Friday and skip holidays listed in Settings.
- 7, 15 and 30-day tasks use calendar days from the scheduled due date.
- Late completion does **not** push the next due date later.
- Unfinished cycles stay visible; exactly one future cycle is prepared.
- Default deadline is 18:00 IST, configurable per task.
- The first scheduler run after the deadline alerts the manager.
- Acknowledgement is due 2 elapsed hours after the manager email is sent.
- Resolution is due 24 elapsed hours after the task deadline.
- Leadership gets one alert if either SLA fails. Completing the task stops further
  escalation.
- The scheduler runs every 15 minutes by default; Google outages or quota limits
  can delay it.

## Setup

1. Upload `Recurring_Tasks.xlsx` to Google Drive. Open it in Google Sheets
   and choose **File > Save as Google Sheets**.
2. Open **Extensions > Apps Script**. Replace `Code.gs` with the full contents of
   `Automation.gs` and save.
3. Set the Apps Script project time zone to **Asia/Kolkata**.
4. Keep **Email mode = DRY_RUN**. Enter real manager and leadership addresses in
   **Settings**.
5. Enter real employee emails in **Task Master** and share the sheet with those
   accounts as editors.
6. Run **setup** as the sheet owner and approve the Google permissions. Reload the
   workbook.
7. Run **Recurring tasks > Check installation** and fix any **NEEDS ACTION** rows.
8. Run **Recurring tasks > Run isolated demo tests**. **Test Cases** should show 31
   passing cases. This sends no email.

See `Setup_and_Tests.txt` for the full install, employee/manager process, the
timed live-demo procedure, the eight required tests and the permissions/limits
notes.

## Tests

- **31 shared-engine tests** run inside the sheet via **Recurring tasks > Run isolated
  demo tests**. No email is sent.
- `test-adapter.mjs` runs the engine against a mock adapter locally:
  `node test-adapter.mjs`. It covers sheet writes, email calls, permissions,
  history and repeated runs.
- `build.mjs` rebuilds the workbook and the preview screenshots.

## Files

| File | Purpose |
| --- | --- |
| `Automation.gs` | The bound Apps Script automation source. |
| `Recurring_Tasks.xlsx` | The workbook (exported copy). |
| `Setup_and_Tests.txt` | Install steps, SLA notes, required tests, permissions and limits. |
| `preview-*.png` | Screenshots of each sheet and the timed demo. |
| `build.mjs`, `test-adapter.mjs` | Local build and test harness. |
| `demo-state.json`, `test-results.json` | Demo state and recorded local test results. |

## Notes and limitations

- WhatsApp completion is recorded as attestation with evidence; ticket IDs are
  syntax-checked. Neither external service is queried through an API.
- *Completed by* is the assigned employee label, not an independently verified
  login.
- Email delivery is best effort: a spreadsheet write and an email send cannot form
  one atomic transaction, so uncertain sends are never retried automatically.
