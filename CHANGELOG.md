# Changelog

## Unreleased — SSO-only authentication

### Changed

- **Sign-in is now SSO-only.** The local username/password login has been removed
  entirely; OIDC is the single authentication provider. `/login` offers one SSO button,
  and a deployment missing any OIDC variable says so instead of rendering a form that
  cannot work.
- **Access stays pre-provisioned, with no just-in-time provisioning.** An SSO identity
  an ADMIN has not created at `/settings/users` is refused and lands on
  `/login?error=AccessDenied`. Roles are read from the `User` record, never from an IDP
  claim.
- **User administration no longer handles credentials.** Creating or editing a user
  takes a username, a role and profile assignments. The username must match the one
  the IDP presents.
- **`callbackUrl` validation returns to the NextAuth default**, which restricts absolute
  URLs to the deployment origin. The previous override accepted any absolute URL.
- **Bootstrap accounts come from `SEED_ADMIN_EMAILS`** (comma-separated company emails)
  instead of `SEED_ADMIN_PASSWORD`. A missing value now warns and skips rather than
  aborting the seeder part-way, which used to leave OPS without its configurable
  permissions while the container still reported healthy.

### Removed

- `bcryptjs` dependency, and every credential-handling path in `lib/auth.ts`,
  `lib/db/seed.ts`, `app/api/users/*` and the user administration UI.
- `SEED_ADMIN_PASSWORD` environment variable.

### Notes

No database migration. The `User.password` column is retained, unused and defaulting to
an empty string, so rolling back to the previous image stays a tag change.

---

## v1.0.0 — 2026-03-25

Initial open source release. Entries below describe that release as shipped; the
authentication behaviour they mention has since been replaced (see Unreleased above).

### Features

- **DOCX conversion** — Pandoc extracts structure and images; AI Vision generates image descriptions; outputs `full.md`, `text-only.md`, `images/`
- **PDF conversion** — Ghostscript renders PDF pages; AI Vision reads content page by page; outputs `text-only.md`
- **Batch upload** — convert multiple files in a single session
- **Multi AI provider** — Gemini, OpenAI, Anthropic switchable from the Settings UI; API keys encrypted AES-256
- **Image compression** — Sharp resizes images to max 1600px at 80% quality before AI processing
- **PDF compression presets** — screen / ebook / printer / prepress via Ghostscript
- **Inline editor** — preview and edit Markdown output before downloading
- **Conversion history** — list of past conversions with download and delete
- **Auto cleanup** — uploads and outputs deleted after 24h
- **Setup wizard** — `/setup` page for first-run admin account creation
- **Self-hosted auth** — NextAuth.js with bcrypt-hashed passwords stored in DB
- **Settings page** — AI provider selection, API key management, custom prompt editor
- **Bilingual prompts** — English and Vietnamese AI prompt presets
- **Deploy scripts** — `deploy/deploy.sh`, `deploy/setup-vps.sh`, `deploy/nginx.conf`
- **Docker support** — `Dockerfile` + `docker-compose.yml`


## Unreleased — Profile Integration Config

### Added

- Profile and endpoint integration configuration for file-URL authentication, callback destination/authentication, `WITH_RESULT` callback payloads, default URL-download chunks, and callback delivery diagnostics.
- Configurable APIC **gateway headers** with arbitrary header names. They are applied to outbound token, file-download and callback requests; existing `ibm_client_id` remains compatible as `X-IBM-Client-Id`.
- Field-level endpoint inheritance for file auth, callback URL and callback payload: exact endpoint value → service endpoint value → existing Profile fallback.
- Preferred callback request field `callback_url`; legacy `webhook_url` remains supported indefinitely.

### Compatibility and safety

- File URLs remain caller-driven and callbacks destination-driven. `fileUrlEnabled` and `callbackEnabled` are retained only as additive/no-op compatibility columns; they do not gate input or callback delivery.
- Supplying both callback aliases with different values is rejected with HTTP 400. Supplying either alias, or both with the same value, is supported.
- Existing Profile behavior stays unchanged until new callback/auth/payload configuration is explicitly set. Legacy `ibm_client_id`, Payroll `csp_*` parameters and inline workflow file auth remain supported.

### Validation tightening

- `file_urls[].total_chunks` must be a positive integer when provided; valid existing requests are unchanged.
- `file_urls[].file_id` must be a string when provided; valid existing requests are unchanged.
