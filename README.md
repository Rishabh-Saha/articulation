# Articulation Lab

A personal, 42-day speaking journal. Record a minute, keep the video in Google Photos, and use this app to notice what changes. Built from the supplied handoff and HTML reference with React, TypeScript, Vite, Tailwind CSS, and Firebase.

The [five release requirements and their actual status](docs/acceptance.md) cover data safety, access across devices, free-only operation, automatic AI ratings, and daily notes. Public hosting and live Firebase setup are still pending; automatic AI analysis has an inactive implementation that still needs live free-tier and real-media verification (see [activation guide](docs/automatic-analysis.md)).

## Run it

Requires Node.js **22.12+** (tested on 24.19), npm, and a modern browser.

```sh
cd /workspace/articulation
npm ci
npm run dev
```

The app works without Firebase in **device-only mode**. No sample scores or baseline are inserted. It saves metadata to browser storage, never video files. Clearing site data removes device-only entries, so export a JSON backup and put it in a secure cloud folder every week.

## What is implemented

- Six weeks / 42 daily cards, explicit completion, next incomplete day, desktop and mobile layouts.
- The exact seven audio and five visual criteria; independent evidence notes, unscored gaze and movement observations, reflections, and timestamped outside feedback.
- A searchable **Notebook** for all 42 days, with free-form notes and reflections shared with the session view. Old entries and backups default the new notes field to an empty string.
- HTTPS Google Photos or other external video links, opened in a new tab with no embed or server-side download.
- Self / AI audio, visual, and combined trends. Unrated days are gaps, not zeroes; combined averages give each assessed criterion equal weight.
- Optional Google sign-in, Firestore subscription, per-day transactional revisions, debounced cloud writes, durable local pending queue, explicit conflict resolution, and account-isolated local storage.
- Versioned JSON export of all 42 entries; validated, previewed import with **keep existing** as the default. Per-day replacement requires an explicit selection.
- Migration of the actual supplied HTML's `{version:1, records:{...}}` export. Legacy AI notes and the single legacy score are preserved separately, excluded from structured AI trends.
- Manual AI Studio prompt / structured JSON import, validated with Zod, with provenance and full review history. The optional in-app MP4 analysis implementation uses a disabled-by-default authenticated Worker/Pages backend; manual review remains available.
- Firestore owner-only rules, build-time security headers for Cloudflare Pages, and no secret credentials in the browser.

## Connect a real cloud journal

These steps need your Firebase account. They were not performed against a live project during implementation.

1. Create a Firebase project on the **Spark (no billing)** plan. Do not enable billing, App Hosting, Functions, or Storage for this app.
2. Register a web app and copy its **public web config**. Enable **Google only** under Authentication → Sign-in method. Choose a support email when requested.
3. Create a Cloud Firestore database in **production mode**, choosing a suitable region. Publish the repository's `firestore.rules` through the Firebase console, or use `npx firebase deploy --only firestore:rules --project YOUR_PROJECT_ID` after authenticating the CLI locally.
4. Copy `.env.example` to `.env.local` and fill its four public `VITE_FIREBASE_*` values. These are web app identifiers, not service-account credentials. Never add a Gemini key, private key, or service account to a `VITE_*` variable.
5. Under Authentication → Settings → Authorized domains, add the exact deployed `YOUR_SITE.pages.dev` hostname and any custom host you actually use. Add `localhost` for local Google sign-in if it is not already authorized. Use a fixed authorized domain for testing; arbitrary preview hosts are not automatically trusted.
6. Restart Vite, click **Connect cloud**, and sign in. Entries created before sign-in stay separate; use **Review & import** to move selected device entries into your account.
7. Confirm the status reaches **Saved to cloud**. Open another browser, sign in with the same Google account, and verify the entry appears. Also test this against your real deployment; emulator tests do not prove production configuration.

Rules grant Google-authenticated users access only to `users/{theirUid}/days/{1..42}`. All other paths are denied. They constrain wrapper fields, day IDs, self-rating shapes and bounds, URLs, text lengths, and revision increments; arrays are length-bounded. Structured AI and feedback contents are validated by the application. Owner access is not a substitute for backend validation if adding shared/public features later.

## How saving behaves

The cloud document shape is `{entry: DayEntry, revision, lastMutation, updatedAt: serverTimestamp}`. Cloud metadata is fetched before writes are allowed; the browser's cached values never establish cloud confirmation. Every edit first updates a local draft. Writes debounce for 750 ms and compare the last cloud revision inside a Firestore transaction. A queued draft is cleared only after a matching transaction is confirmed. Editing during a transaction produces a new pending mutation rather than dropping the new text.

If another browser changes the same day, the app preserves both versions and asks you to download them or choose **Use cloud / Keep my draft**. It does not combine prose automatically. JSON imports similarly offer keep/replace per day. A cloud outage leaves drafts in place and shows an actionable error. Retry sync after resolving connection, rule, or quota errors.

Local data is scoped to `articulation-lab:v2:guest` or `articulation-lab:v2:UID`. Signing out does not erase local account copies: use a trusted device. Unreadable existing storage is preserved and editing is paused; **Export original browser data** downloads it for recovery. Quota failures are surfaced and in-memory entries can still be exported. Offline editing requires an already loaded page; this version is not an installable/offline-first PWA. **Web Locks allows only one editing tab per browser/account**; other tabs cannot edit/import and automatically take over after the writer closes, loading the latest draft first. Use a current browser on HTTPS or localhost; unsupported contexts pause editing. A previously confirmed day missing from the cloud is preserved locally and flagged, with an explicit restore action; it is never silently deleted or reported as cloud-saved. Firestore documents have a 1 MiB limit; very long AI histories may need child collections in a later version.

## Backups and prototype migration

1. In the original HTML, click **Export feedback**. The supplied prototype uses **IndexedDB**, not localStorage.
2. In this app, open **Backups & import → Choose JSON file** and select the old export.
3. Review the listed days. New days are selected; existing days are kept unless explicitly selected for replacement. Export the current journal before replacing anything.
4. Import, confirm save status, then export a new schema-version-2 backup.

**Find prototype data on this site** can read the old `articulation-lab-v1` IndexedDB database only if both apps share the same origin. File URLs, a different host, or a different browser require the export/import route. Original prototype data is never deleted.

Backups include scores, evidence, dates, comments, video URLs, and model/prompt metadata. They contain **no videos**. Keep exports privately: a Google Photos share URL can expose its video to anyone who has the link. Independent exports complement Firestore; provider-managed backups are not assumed to be free.

## AI review: in-app implementation and manual fallback

The AI review tab supports local MP4 selection, consent, upload/analysis states, and saving validated feedback as a new version through a same-origin Worker/Pages backend. It remains **disabled by default and not live-verified**. Read the [automatic analysis activation guide](docs/automatic-analysis.md) for server-only bindings, free-only requirements, D1 caps, temporary-file cleanup, and required real-video testing. Static Vite hosting alone does not run this backend. No Gemini secret belongs in a frontend variable.

Use the **AI review** tab to copy the exact rubric prompt. In Google AI Studio, independently verify a video-capable model currently has a free tier and choose it explicitly. Read the privacy terms before attaching your local file. Free-tier Gemini content may be used to improve provider products. This external upload is your action; the app receives only the JSON you deliberately import.

The importer requires all 12 criteria, nullable integer 1–5 scores, evidence, suggestions, model, prompt version, filename, analysis date, strengths, improvements, exercise, and limitations. Unknown modalities remain **Not assessed**. User confirmation that the actual video was supplied is required. Averages are recomputed; model-supplied averages are ignored. Each import adds a version; it never replaces self-ratings or old AI reviews. Model filler counts and timestamps are estimates, not verified facts.

Before activating automatic analysis, separately verify current official pricing/model availability and prove a streaming/resumable upload path with real media. The backend must verify Firebase JWT signatures and claims, restrict to a single allowed UID, enforce MIME/size/rate/daily caps, restrict CORS to the deployed origin, retain no permanent video, and keep the API key in a Worker secret. Do not expose a key or use an insecure stub to bypass those prerequisites.

## Keep the existing Cloudflare Worker

The current deployment uses **Workers**, with the `articulation.rsaha130.workers.dev` address. Keep that existing Worker. `wrangler.jsonc` now includes the executable `server/worker.ts` backend and static `dist` assets. The build command is `npm run build` and the deploy command is `npx wrangler deploy`. Preserve the existing Firebase build variables. After this code is deployed, the Worker can accept the `AI_LIMITS` D1 binding; an asset-only Worker cannot. The [activation guide](docs/automatic-analysis.md#existing-cloudflare-worker-keep-this-deployment) covers the exact order and free-only account settings. No site-address or journal-data migration is needed.

Use `npm run build:worker` for a local build/dry run without deployment, `npm run dev:worker` for the local Workers runtime, and `npm run test:worker` for routing checks. The original `npm run dev` remains the frontend-only Vite workflow.

## Optional: deploy a static Pages app

No deployment was performed during implementation. Cloudflare account access and live Firebase configuration remain external setup steps.

1. Push this repository to your private GitHub repository.
2. In Cloudflare Pages, connect the repository using the **Free** plan. Set build command **`npm run build`**, output directory **`dist`**, and root directory to the repository root. Select Node 24 (or a supported Node >=22.12).
3. Add the four public Firebase config values as Pages build environment variables; Vite embeds these public values at build time. Rebuild after changing them.
4. Use the free `*.pages.dev` address and add that exact hostname to Firebase authorized domains. Do not add payment details for features this version does not use.
5. Verify Google sign-in, a complete self-review save, refresh, another browser, export/import, and the served security headers. The repository's `public/_headers` is copied into `dist`; Vite dev/preview does not apply Pages headers.

The static UI and manual workflow require no paid service. Free plan terms and quotas can change; this implementation has not re-certified live pricing. Confirm current limits before publishing or enabling any new provider integration:

- [Cloudflare Pages limits](https://developers.cloudflare.com/pages/platform/limits/)
- [Firebase Spark plan](https://firebase.google.com/docs/projects/billing/firebase-pricing-plans) and [Firestore pricing / free quotas](https://firebase.google.com/pricing)
- [Gemini model pricing](https://ai.google.dev/gemini-api/docs/pricing), [video understanding](https://ai.google.dev/gemini-api/docs/video-understanding), and [Files API](https://ai.google.dev/gemini-api/docs/files)

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit --omit=dev
# With npm run dev running, and Chromium installed:
npm run test:e2e
npm run test:a11y
npm run test:safety
```

Browser checks default to `/usr/bin/chromium` and port 5173. Override `CHROMIUM_PATH` and `APP_URL` when needed. Screenshots go to ignored `test-results/`. AI data used in tests is explicitly a fixture, never initial user content. A compatible patched `@grpc/grpc-js` override addresses Firebase's older transitive dependency; the production audit was clean at implementation time.

### Firestore rules and cross-browser integration

Requires **Python 3.12+**, **Java 21+**, and Chromium. The emulator installer uses Google's official Cloud SDK distribution on `dl.google.com` and verifies its published SHA-256 checksum. It preserves TLS verification and inherits configured proxies/CA trust. This avoids the Firebase CLI's separate emulator distribution host, which is not allowed in the managed environment.

```sh
npm run setup:emulators
npm run emulators
```

In another terminal:

```sh
FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 npm run test:rules
npm run dev:cloud-test
```

And another terminal:

```sh
npm run test:cloud
```

These tests use `demo-articulation`, an emulated Google identity, Auth port 9099, and Firestore port 8085. The app connects to emulators **only** with `VITE_FIREBASE_EMULATORS=1` in a Vite **development** build. Production builds never honor this flag. No real Google account, project credentials, or live Firestore writes are used. Stop the processes with Ctrl-C after testing. `ARTICULATION_EMULATOR_DIR` can select an existing verified emulator directory for setup and startup.

The suite covers unauthorized access and schema rejection, persistence across isolated browsers, durable offline edits, conflicting remote edits, explicit resolution, and reload restoration. Live OAuth popup behavior, production rules deployment, hosted CSP, free-tier quotas, actual Gemini evaluation, and a public deployment need separate live verification.
