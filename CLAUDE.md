# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

AluguelMaster is a rental property management system (Portuguese/pt-BR UI) for residential and commercial leases: property listings, contracts with PDF generation, payment tracking, and email notifications. Originally a Google AI Studio applet (Gemini API key still injected at runtime by that platform); the data layer has since migrated off Firestore to Postgres (Neon) — see Architecture below.

## Commands

- `npm run dev` — start the app (runs `server.ts` via `tsx`, which wraps Vite in middleware mode; serves on port 9999)
- `npm run build` — production build (`vite build`)
- `npm run preview` — preview the production build
- `npm run lint` — type-check only, no ESLint (`tsc --noEmit`)
- `npm run clean` — remove `dist/`
- `npx prisma studio` — spreadsheet-style GUI for browsing/editing the Postgres data
- `npx prisma generate` — regenerate the Prisma Client after editing `prisma/schema.prisma`

There is no test suite configured in this repo. Package manager is Yarn (see `packageManager` field in package.json), though a `package-lock.json` also exists — prefer `yarn` for installs.

## Architecture

**Hybrid backend: Firebase for identity/files, Postgres for everything else.** Google Sign-In and file storage (signed contract uploads) still go through Firebase (`src/firebase.ts` exports only `auth`/`storage`/`signIn`/`logout` now — no Firestore). All application data (`User`, `Property`, `Contract`, `Payment`, `Settings`) lives in Postgres on Neon, defined in `prisma/schema.prisma` and accessed **only from the server** via Prisma — the client never talks to the database directly, it calls a REST API under `/api/*`.

**Why Neon's driver adapter, not a plain TCP connection.** `src/server/prisma.ts` builds the `PrismaClient` with `@prisma/adapter-neon`, which talks to Postgres over HTTPS/WebSocket (port 443) instead of the raw wire protocol (port 5432). This was adopted because the dev network here blocks outbound 5432, but it's used unconditionally (not just as a workaround) since it's Neon's recommended approach for serverless/edge-style runtimes generally. A consequence: the Prisma CLI's own DB-touching commands (`migrate dev`, `migrate resolve`, `db pull`) still need a direct TCP connection and **will fail on a 5432-blocked network**.

**How schema changes actually get applied here.** Write the new migration by hand as a new folder under `prisma/migrations/<timestamp>_name/migration.sql` (generate the SQL locally with `prisma migrate diff --from-... --to-schema-datamodel prisma/schema.prisma --script`, which needs no DB connection — just diffs two schema representations). Then apply it either by pasting into the Neon console's SQL Editor, **or** by running each statement through the adapter-based client with `prisma.$executeRawUnsafe(sql)` in a throwaway script (`tsx` a one-off `.mjs`/`.ts` file that imports `src/server/prisma.ts`) — this works over the same HTTPS connection the app already uses, so it succeeds even on a 5432-blocked network, unlike the Prisma CLI. After either path, run `npx prisma generate` to refresh the generated client types (this only needs the schema file, no DB connection — though on Windows it can fail with `EPERM` on the query-engine `.dll.node` if a `tsx server.ts` process still has it loaded; stop that process first, then regenerate).

**Custom server, not plain Vite.** `server.ts` is an Express app that wraps Vite as middleware in dev (`createViteServer({ middlewareMode: true })`) and serves `dist/` statically in production. It also hosts every `/api/*` route — there is no separate backend process.

**Auth middleware, not security rules.** There's no Firestore-rules equivalent; authorization is real server-side code in `src/server/auth.ts`:
- `requireAuth` — verifies the `Authorization: Bearer <Firebase ID token>` header via `firebase-admin` (`admin.auth().verifyIdToken`).
- `loadProfile` — loads (or bootstraps) the caller's Postgres `User` row by uid. First-login bootstrap logic lives here now (moved from the old client-side `useAuth.tsx`): migrate a pre-registered invite matching the login email, or create a default `tenant` profile + send a welcome email.
- `requireRole(...roles)` — 403s if the loaded profile's role isn't in the list.

Each `src/server/routes/*.ts` file (one per resource: `me`, `properties`, `contracts`, `payments`, `users`, `settings`) applies these plus resource-specific field checks — e.g. a landlord's `ownerUid`/`landlordUid` on create is always forced to their own id server-side, and only admin/landlord (never tenant) can mark a payment paid. This is deliberately stricter than the old Firestore rules, which allowed a client to write almost any field on a document it could reach.

**Client → API, not client → database.** `src/lib/api.ts`'s `apiFetch()` attaches the caller's Firebase ID token to every request; pages call it instead of a DB SDK. There is no real-time sync (no Firestore `onSnapshot` equivalent) — each page fetches on mount and refetches after any mutation it performs.

**Two data shapes get bridged, deliberately, instead of a repo-wide rename:**
- The API returns Postgres rows keyed by `id`; the client still addresses users by `uid` everywhere (a holdover from Firestore). `useAuth.tsx`'s `toUserProfile()` and the `/api/*/directory`-consuming pages map `id` → `uid` on the way in rather than renaming every `profile.uid`/`u.uid` call site.
- Prisma returns `Decimal` for money columns and UTC-midnight `Date` objects for `@db.Date` columns; `src/server/serialize.ts` converts these to plain `number` and `"yyyy-MM-dd"` strings before a response goes out, so the client's existing `toLocaleString()`/`date-fns` calls keep working unmodified. The date conversion specifically uses `date.toISOString().slice(0, 10)` rather than `date-fns format()`, because `format()` reads the *server's local* timezone and would shift the calendar day by one on a non-UTC server.

**PII scoping.** `GET /api/users` (full profile: email, phone, invite status) is admin-only. Any authenticated user can hit `GET /api/users/directory` for the minimal cross-reference data other pages legitimately need (a tenant's own contract PDF needs their landlord's name/CPF/address) — `{id, displayName, cpf, address, role}`, deliberately omitting email/phone.

**SMTP password never reaches the client.** `PUT /api/settings` accepts a plaintext `smtpPassword`, encrypts it server-side (`SETTINGS_ENCRYPTION_KEY`, server-only env var — unlike the old `VITE_ENCRYPTION_KEY`, never bundled into client JS), and `GET /api/settings` returns only a `smtpPasswordConfigured: boolean`, never the value. `src/server/mailer.ts` reads/decrypts it internally when sending mail.

**Reminders and email are still server-triggered, not cron.** `POST /api/reminders/process` (admin-only now) scans `Contract`s expiring within 30 days and `Payment`s due within 3 days/overdue, deduped via each row's `reminderSentAt`. Triggered client-side by `ReminderTrigger` in `src/App.tsx`, gated by a `localStorage` timestamp so it fires at most once per admin session per day.

**PDF generation** happens client-side in `src/pages/Contracts.tsx` / `src/pages/Payments.tsx` using `jspdf` + `jspdf-autotable` — contract and receipt documents are generated in the browser from data already fetched via the API, not on the server.

**Pages are large, self-contained.** Each `src/pages/*.tsx` file (200–900+ lines) owns its own data fetching (via `apiFetch`), forms, and modals rather than delegating to shared feature components — `src/components/` only holds cross-page chrome (`Layout.tsx`, `ConfirmModal.tsx`). When editing a page, expect the relevant API calls, mutation handlers, and UI to all live in that one file.

**Styling** uses Tailwind CSS v4 (via `@tailwindcss/vite` plugin, no separate `tailwind.config`) with a `cn()` helper (`clsx` + `tailwind-merge`) repeated locally in components that need it — dark mode is class-based (`dark:` variants toggled via the theme system in `useAuth.tsx`).

**Path alias**: `@/*` maps to the project root (see `tsconfig.json` / `vite.config.ts`), not `src/`.
