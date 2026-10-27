# AGENTS.md

dugate: Document Understanding Gateway. Next.js 14 (App Router) + TypeScript + Drizzle/PostgreSQL + Redis/BullMQ.
`CLAUDE.md` holds the long feature/API overview, but parts are **stale** (see "Stale docs" below). Trust code and config over it.

## Must-read before editing
- `docs/SECURITY-RULES.md` before touching `app/api/**/route.ts`, secrets/tokens/sessions, or file uploads (CLAUDE.md summarises the 11 rules). Highlights: never return decrypted secrets, state changes are `POST` not `GET`, no real credentials in any tracked file (tests/scripts/docs included), outbound `fetch` carrying a credential uses `ssrfSafeFetch` plus `signal: AbortSignal.timeout(ms)`.
- `docs/feature-development-checklist.md` (Vietnamese) before adding any workflow/endpoint/LLM call. Every LLM call needs an admin-overridable prompt (`promptOverride?` in a builder under `lib/pipelines/workflows/prompts/`), and every request-time param must be declared in `lib/endpoints/registry.ts`.
- Reference implementation for a new workflow: `lib/pipelines/workflows/statement-analyze.ts`; guide in `lib/pipelines/workflows/README.md`.

## Commands
- `npm run dev` (port 2023), `npm run worker:dev` (`npx tsx worker.ts`). Dev needs both, plus PostgreSQL and Redis. Copy `.env.example` to `.env`.
- `npm test` = `jest`; only `tests/**/*.test.ts` are picked up (node env, `@/` alias mapped). Single file: `npx jest tests/<dir>/<file>.test.ts`.
- Typecheck: `npx tsc --noEmit`. There is **no ESLint config**; `npm run lint` is not meaningful and `next build` skips ESLint. `next build` does run type-checking.
- `*.postgres.test.ts` (e.g. `tests/operations-request-tracking/`) are `describe.skip` unless `OPERATIONS_TRACKING_TEST_DATABASE_URL` or `TEST_DATABASE_URL` points at a disposable DB. They create/drop their own schema; never point them at the app DB.
- `npm run seed` = `npx tsx lib/db/seed.ts`. Other generators: `npm run sync:loan-catalogs`, `npm run gen:loan-doc-schemas`.

## Agent working rules (tests & autonomy)
- Run tests sparingly. Do NOT run `npm test` / `npx jest` over a whole directory or the whole repo (jest also picks up `.worktrees/` and `.kilo/worktrees/` copies and reports unrelated failures). Pure UI/copy/layout/styling changes need no test run at all.
- Only run a test when the change touches logic it covers, and then only the single most relevant file (`npx jest tests/<dir>/<file>.test.ts`), once, after the edits are done. Do not re-run to "double check".
- Prefer `npx tsc --noEmit` as the cheap validation for TS/TSX edits; skip it too for trivial text-only edits.
- Do not investigate pre-existing failing tests unless the user asks.
- Never commit, push, or touch secrets unless explicitly asked.

## Database: Drizzle, not Prisma
- Schema: `lib/db/schema.ts`; client: `lib/db/index.ts`; config: `drizzle.config.ts`; SQL migrations in `drizzle/`.
- Docker entrypoint runs `drizzle-kit push --force` when `MIGRATION=true` and refuses to start if it fails. A schema change therefore must also be reflected in a `drizzle/*.sql` migration file for the hand-applied path.

## Worker bundle gotchas
- `worker.ts` runs as a separate process. The Docker image bundles it with esbuild; the `--external:` list in `Dockerfile` **must match** `worker:build` in `package.json` (they have drifted before; `pdf-parse` must stay external so pdfjs keeps its assets).
- `worker.js` is gitignored build output. Do not edit it. `worker.pam.js` **is** tracked and has been deliberately left untouched by recent work (`git diff -- worker.pam.js` should be empty); leave it alone unless asked.
- `next.config.mjs` keeps `pdf-parse`, `pdfjs-dist`, `sharp`, `pdf-lib` as server externals; bundling them breaks PDF routes.

## Architecture pointers
- API: `app/api/v2/docs/{extract,analyze,transform,generate,compare,workflows}` is canonical; `app/api/v1/*` stays for backward compat (including deprecated `ingest`). Dispatch goes through `lib/endpoints/runner.ts` using `SERVICE_REGISTRY` in `lib/endpoints/registry.ts`.
- Workflows: handler functions in `lib/pipelines/workflows/*.ts`, registered in `WORKFLOW_REGISTRY` (`lib/pipelines/workflow-engine.ts`) **and** as `SERVICE_REGISTRY.workflows.subCases` in the registry. Each sub-step is its own BullMQ job via `enqueueSubStep`. Changes to `workflow-engine.ts` must stay backward compatible (additive optional fields only).
- Auth is SSO-only (OIDC) with no JIT provisioning; API clients use `x-api-key`. Rate limiting is in the runner (Node), not `middleware.ts` (Edge).
- Domain areas with their own `tests/` dirs and `lib/` modules: loan-dossier, loan-appraisal(-v2), payroll-verify, structure-compare, margin-deposit, payment-account-management, operations request tracking, tracing-portal.

## Stale docs / traps
- CLAUDE.md says Prisma and `prisma/schema.prisma`, "7 models", `prisma db push`: all outdated. The repo uses Drizzle (see above); `lib/prisma.ts` does not exist.
- `tests/workflows/eval/` is gitignored (local eval ground-truth); don't expect it in a clean checkout.
- `docs-site/` is a VitePress site auto-deployed to GitHub Pages on push to `main` (only CI workflow: `.github/workflows/docs.yml`); there is no CI for tests/typecheck, so run `npx tsc --noEmit` and `npm test` yourself.
- `.worktrees/` and `scratch/` are not gitignored; do not `git add -A`.
- Repo root contains many untracked/scratch artifacts (`*.log`, `*_scan.txt`, `scratch/`, `tmp/`, `.tmp_specval/`, `dump.rdb`); don't commit them or build on them.
- Many docs, comments and commit messages are Vietnamese; commit style is `type(scope): D-<n> description`.
- Path-prefixed `file:line` citations in docs should come from `git grep -n`, not manual counting, and pin old code to a commit.
