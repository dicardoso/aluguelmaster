# Tests

Run against the database in `DATABASE_URL`, so the harness refuses to start unless `APP_ENV` is `develop`, `local` or `test`, `PRODUCTION_DATABASE_HOST` is set, and the URL doesn't contain it. The guard fails closed: with `PRODUCTION_DATABASE_HOST` unset nothing runs. Set it to the production endpoint's unique part (e.g. `ep-cool-name-123456`, not just `neon.tech`) — it must not appear in the test database's URL. The test database also needs the current schema (every migration under `prisma/migrations/` applied). Everything the tests create uses e-mails under `@e2e.locatto.local` and is deleted afterwards; `Settings` and `reminderSentAt` stamps are snapshotted and restored.

| Command | What it does | Needs |
|---|---|---|
| `npm test` | unit + API integration (the real Express app, in-process) | DB |
| `npm run test:unit` | pure functions (late fee, serialization) | nothing |
| `npm run test:e2e` | browser flows by role (Playwright/Chromium, headless) against the real app + Vite | DB, `npx playwright install chromium` |
| `E2E_ADMIN_EMAIL=you@gmail.com npm run test:e2e:real` | same flows with a **real Google login**: start `npm run dev` first, sign in in the visible Chrome window | DB, Chrome, running app |

How auth and mail are handled:

- **Firebase auth is stubbed.** `tests/lib/harness.mts` replaces `verifyIdToken` with a decoder for `test.<base64 claims>` tokens. For browser tests, a Vite plugin swaps `src/firebase.ts`, `firebase/auth` and `firebase/storage` for the fakes in `tests/fakes/` (identity comes from `localStorage.e2e_token`). No app code is touched.
- **No real e-mail is sent.** `nodemailer.createTransport` is replaced so messages are captured in `mail` (the Settings row of the database may hold live SMTP credentials). `test:e2e:real` runs the real server, so it *does* send mail, but only to `@e2e.locatto.local` addresses plus whatever the app's own reminders do.
- `test:e2e:real` skips the signed-contract upload (it would write to the real Firebase Storage bucket).

Browser artifacts (screenshots, PDFs/CSVs, the Chrome profile that keeps the Google session) go to `tests/.output/` (gitignored). `tests/e2e/crawl.mts` is a report-only script that visits every page per role and lists console/API errors.

Tests named `PROBE:` assert behaviour the API should have (4xx instead of a hang, no duplicate months, ...); they are regression tests for bugs found during the first validation round.
