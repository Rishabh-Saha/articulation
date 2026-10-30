# Automatic analysis: implementation and activation

The AI review tab now defaults to this day’s saved Google Photos share link. After deliberate consent and Analyze, it sends the link to the same-origin `/api/analyze` backend. The backend attempts to retrieve the selected public video and uses the same capped Gemini analysis pipeline as a local MP4 upload. Local MP4 files (12 bytes–20 MiB) remain an optional fallback. The UI shows queued, uploading, analyzing, complete, and retry states, offers cancellation, validates returned feedback, and lets the user save a new review version. For Photos, the combined retrieval/review state includes backend download, provider upload, and analysis. Local-file upload describes browser-to-backend transfer; analyzing includes backend-to-provider upload and processing. No video is added to browser storage, backups, Firestore, or D1. Changing day or leaving the AI tab cancels the browser request and discards an unsaved result; a server request may still finish and consume an attempt.

**Not activated or live-verified.** This change is implementation progress, not proof of real video analysis or a public deployment. Pricing documentation was inaccessible from the development environment (HTTP 403). A real Photos link was supplied, but the user elected to test it live rather than grant workspace network access. Automated retrieval tests use synthetic shared-page and MP4 fixtures; they do not establish compatibility with the current live Photos page. No provider key is available in this workspace. Keep `AI_ENABLED` unset until the live checks below succeed in a controlled test deployment. There is no default model or paid fallback.

## Free-only prerequisites

Use an unbilled Gemini project with a currently free, video-capable model. Independently check [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing), [Files API](https://ai.google.dev/gemini-api/docs/files), [video understanding](https://ai.google.dev/gemini-api/docs/video-understanding), and provider-use privacy terms. Select the exact model identifier explicitly. Never attach billing to this app's Gemini project. A configuration flag cannot detect a billed key or guarantee future provider pricing; account configuration and current eligibility are required. If free access is unavailable, leave automation disabled and use manual AI Studio review with a free model.

Keep Firebase on Spark, Cloudflare Workers/Pages and D1 on their free plans. Do not enable paid Workers, paid model fallback, Firebase Functions, Firebase Storage, or R2. Provider free quotas can be lower than the app's limits; failures stop without retrying automatically. Functions/D1 quota exhaustion must fail closed; it must not bypass the counter.

## Existing Cloudflare Worker: keep this deployment

The current site is `articulation.rsaha130.workers.dev`, deployed as a Worker with static assets. Keep that Worker and address. Both Workers and Pages offer free plans; moving to Pages is unnecessary. Changing origins would separate browser-stored journal drafts and require Firebase authorized-domain updates. There is no data migration in this fix.

The message **“Bindings cannot be added to a Worker that only has static assets”** means the deployed version has no executable backend. The repository now includes `server/worker.ts` and `wrangler.jsonc` to serve `/api/analyze` through the existing authenticated handler. All other app assets keep their current behavior. `/api` and `/api/*` run the Worker first so that a missing API route cannot return the SPA's HTML. The Pages adapter remains available for existing Pages users.

### First deploy the executable Worker

1. Get the updated repository code (including the earlier analysis implementation, `server/worker.ts`, `wrangler.jsonc`, and the lockfile) onto the GitHub branch connected to the existing **articulation** Worker. Files saved in a Codex environment are not automatically pushed to GitHub or deployed to Cloudflare.
2. In that Worker's **Settings → Build**, use build command **`npm run build`**, deploy command **`npx wrangler deploy`**, and repository root as the root directory. The pinned Wrangler dependency is installed by `npm ci`. Deploy the same existing Worker; do not create a second site. The config's `keep_vars` preserves dashboard runtime variables, and secrets remain server-side. Keep the existing four public Firebase build variables in the build settings; publishing the backend must not remove them.
3. Once this code deployment succeeds, open **Settings → Bindings**. The Worker now has executable code and can accept a D1 binding. Analysis remains disabled until all required settings are supplied.

### Add the free quota database

Create/select the dedicated Free-plan D1 database **`articulation-ai-limits`**. Once bound as `AI_LIMITS`, the Worker automatically creates its quota table if missing on the first analysis request. It never clears existing counters. The equivalent idempotent statement is available in `server/schema.sql` (or can be run manually in the D1 Console when diagnosing setup):

```sql
CREATE TABLE IF NOT EXISTS analysis_limits (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  day TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  last_started INTEGER NOT NULL
);
```

In the existing Worker's **Settings → Bindings**, add a D1 database binding named **`AI_LIMITS`** and select that database. These are only quota counters, never journal records. Leave Firebase/Firestore and all existing journal data alone.

The deployment config now uses Cloudflare’s upload metadata `keep_bindings` for D1, dashboard variables, and secrets, so code updates retain an existing quota binding without inventing a database ID. This metadata passthrough is supported by the pinned Wrangler version. No database is created, reset, or migrated by a code deployment. Local development has no D1 binding unless configured separately. You may still declare the actual binding under `d1_databases` for local database tooling when its non-secret database ID is available.

### Server settings (after the Worker is deployed)

Use the existing Worker's **Settings → Variables and Secrets**:

- `APP_ORIGIN`: `https://articulation.rsaha130.workers.dev` (or the exact current app origin if it changes, without a trailing slash).
- `FIREBASE_PROJECT_ID`: the same Firebase project used by the frontend.
- `ALLOWED_UID`: the one permitted Google-authenticated Firebase UID.
- `GEMINI_MODEL`: exact currently free video-capable model ID; no default or model switching.
- `GEMINI_API_KEY`: a **secret** from that unbilled project. Never add this to `VITE_*`, source control, frontend settings, URLs, or logs. Reuse the secret already added to this Worker; do not create or share another key.
- `FREE_TIER_CONFIRMED=true`: only after verifying current model eligibility and the unbilled project.
- `AI_ENABLED=true`: activation switch, initially absent. Enable only for controlled real-media validation, then for normal use after it passes. Removing it disables analysis without changing journal data.

A **503 “Automatic analysis setup is incomplete”** response lists missing or invalid binding/variable names, never their values. Add or correct those names on the **existing Worker's runtime Variables and Secrets/Bindings**, not only its frontend build settings. `AI_ENABLED` and `FREE_TIER_CONFIRMED` require the exact string `true`; confirm the unbilled project's free-tier eligibility before setting the latter. `AI_LIMITS` is a D1 database binding rather than a text variable. Save/deploy the runtime settings before retrying. Runtime failures include a safe step label for quota storage, Photos retrieval, Gemini upload/processing/review, result validation, or cleanup. Provider HTTP codes are included without raw upstream messages or credentials. Only a missing `analysis_limits` table triggers automatic schema creation; other database failures remain blocked. A valid configuration is still subject to Google authentication, quotas, and real-video verification.

Keep the selected Workers runtime on the Free plan. Validate its streaming and request duration limits with real media; an asset-only deployment or Vite server does not prove the backend works.

## Optional: existing Cloudflare Pages deployments

Pages users can keep the `functions/api/analyze.ts` adapter. Use a Pages workflow that compiles `functions/` alongside `dist`, with the same D1 binding and server-only settings above. The root `wrangler.jsonc` is for Workers; Pages commands must use their own Pages configuration rather than that Workers config. Moving the current Worker to Pages is not necessary.

## Local Worker validation

```sh
npm ci
npm run build:worker  # builds assets and bundles the backend; dry run only, no deployment
npm run dev:worker    # local Workers runtime, loopback only; does not contact Gemini by default
```

In another terminal, run `npm run test:worker`. This verifies the static app and headers, its JavaScript assets, API routing instead of the HTML fallback, and disabled-by-default behavior in the actual local Workers runtime. Use no Gemini secret or activation flags for this check. `.dev.vars` files and `.wrangler/` state are ignored. A local test does not activate production or establish free-tier/model availability.

The backend verifies RS256 Firebase JWT signatures using Google's Secure Token JWK endpoint and checks issuer, audience, expiry, issue/auth times, the exact UID, and Google sign-in provider. It rejects missing consent, invalid MIME and size, foreign origins, and non-MP4 signatures. It never fetches user-provided URLs. The byte stream must match the declared size. Quotas use one atomic D1 statement, allowing at most **one attempt per minute and three per UTC day** for the whole deployment, including failed/cancelled attempts. Do not share a Gemini key with other callers and assume this counter controls them.

### Google Photos retrieval boundaries

Only HTTPS `photos.app.goo.gl/<id>` and `photos.google.com/share/<id>` URLs (including an individual `/photo/<id>` path) are accepted. Every redirect is checked; redirects to sign-in, arbitrary hosts, ports, credentials, and private-library routes are rejected. No Firebase/Gemini tokens or browser cookies are forwarded to Google Photos. Backend retrieval happens only after Firebase authorization, video-sharing consent, and the atomic rate/daily cap.

The resolver reads bounded shared-page JSON data without executing scripts. It requires the selected media ID or exactly one item in the page; it never picks an arbitrary item from an album. It attempts the Google media URL’s `=dv` transformation and requires an actual `video/mp4` response, a valid MP4 signature in the upload stream, and at most 20 MiB. Thumbnails and HTML can never be submitted as video evidence. Redirected media remains restricted to known Google media hosts. The shared-page format is unofficial and can change; a retrieval error is a real failure, not a completed analysis. Photos files usually stream directly; if Google omits their byte length, a bounded in-memory buffer (up to the same 20 MiB) supplies the length needed for Gemini's resumable upload. No permanent video storage is used.

Changing the selected source or saved Photos URL resets consent and discards pending link results. New reviews append to existing history. Notes, self-ratings, old reviews, and journal schemas are unchanged. Live-test both a shared single-video link and an inaccessible or multi-item link; a passed fixture suite is not proof that a real link works.

The backend begins a Gemini resumable upload, streams the video to Gemini, waits for the provider's file to become active, requests the shared 12-criterion rubric, validates the structured response, and supplies trusted model/time/filename provenance. It deletes the provider file before returning success. On failure it attempts deletion through `waitUntil`; if finalization succeeded but its response was lost, or deletion is unavailable, Gemini's documented temporary Files expiry is the fallback (currently 48 hours; verify current terms). Do not promise immediate deletion on every failure. Failed cleanup never returns a successful analysis. No automatic retry or permanent video storage is used.

## Required live verification before claiming completion

- Confirm official current free pricing/model video support and unbilled project status; verify the key stays server-side in built assets and browser requests.
- Use an actual ~60-second speaking MP4. Verify streaming upload, processing, validated criteria, correct filename/model, temporary-file deletion, and a new saved review version. Check the result against the actual video; fixture tests are not evidence of model quality.
- Verify foreign origin, wrong-account and expired/forged-token rejection against the deployed Function; exercise caps across concurrent requests and isolated browsers.
- Verify free-quota/HTTP 429, malformed/truncated/blocked responses, cancellation, timeout, interrupted upload, provider failure, and cleanup failure without paid fallback or journal changes.
- Export a journal first. While analysis is pending, edit notes/self-ratings; verify both those edits and existing review history survive saving the new result. Check backup round trip and Firestore saving against the real Spark project. No schema migration or new Firestore rules are required by this feature.
- Measure actual latency; do not promise immediate ratings through provider quotas.

Local automated coverage uses signed JWTs and mocked Gemini responses, with real in-memory SQLite for cap logic. It does not make paid or live AI calls. Existing journal, backup, and browser regression suites remain required.
