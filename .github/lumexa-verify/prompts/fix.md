You are fixing FUNCTIONAL bugs in a deployed web app. Functional browser tests
ran against the live app and some failed — each failure is a feature from the
PRD that does not work. Make those features work.

## Inputs

- App source — your working directory: `${REPO_DIR}` (React + Vite `frontend/`,
  Express + Prisma `backend/`; read `CLAUDE.md` and `README-agent.md` first).
- PRD: `${WORK}/PRD.md`
- Failing tests with errors and screenshot/trace paths: `${WORK}/failures.md`
- The tests (read-only): `${WORK}/harness/tests/`
- Live app for reproducing: `${APP_URL}` (admin login in env `ADMIN_EMAIL` /
  `ADMIN_PASSWORD`; `playwright` MCP browser tools available).

## How to work

1. Reproduce each failure in the browser and find the ROOT CAUSE in the code.
2. Fix the most clear-cut functional bugs first, with the smallest change.
   **Change at most ${MAX_FIX_FILES} files in total** — a bigger fix is thrown
   away. Leave the rest for the next round.

## Never change (a fix that does is thrown away)

- What already works. Anything that is not the cause of a failing test stays
  exactly as it is.
- Copy and presentation: wording, headings, button/link labels, messages,
  landing/marketing sections, navigation items, layout, styling.
- Routes, redirects, and settings/config values (e.g. session length) unless
  the failure proves a feature is unreachable or broken because of them.
- `.github/`, any `package.json` or lockfile (no new dependencies),
  `backend/prisma/` (no schema or seed changes), Dockerfiles, `buildspec.yml`,
  `backend/bootstrap.js`, `backend/config/index.ts`, `backend/src/lib/prisma.ts`,
  `backend/src/lib/integrationSeam.ts`, `frontend/.env*`, `backend/public/`,
  `design-kit/`, and any third-party integration code (payments, email/SMS,
  OAuth, maps, AI/video providers). Never replace a "not configured" error with
  fake output.
- Do not delete or rename files, do not edit the tests, never run database
  commands and never call the live app's API to change data.

If a failing test is wrong (it checks wording, labels, internals, an integration
or something out of scope — not a broken feature), append its exact id (the
`## ` heading in `failures.md`, without `## `) as one line to
`${WORK}/invalid-tests.txt` and leave the app alone for it. A failure that needs
a schema change or new dependency cannot be fixed here — skip it.

## Before you stop

- `cd backend && npm run build` must succeed.
- `cd frontend && npx vite build --base /` must succeed.

End with: each failing test → fixed (root cause + change) / invalid / skipped (why).
