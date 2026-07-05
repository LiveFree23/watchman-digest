# watchman-digest

The Watchman's morning briefing. A daily email of what's due across Live Free,
Cedar Point, and Altered Life — active tasks due today or overdue, hottest first.

Runs as a scheduled **GitHub Action** (same pattern as `watchman-gate`). No
server, no npm install — just Node 24's built-in `fetch`.

## What it does

1. Reads the `v_due_now` view from Supabase (service-role, read-only).
2. Formats it in the Watchman's amber-on-charcoal voice.
3. Sends it to your inbox via Resend.
4. Fires at **6:00 AM Central**, year-round (DST handled in code).

If nothing's due, it still sends — a short "wall's quiet" so you always know it
ran and didn't just break.

## Setup (one time, ~5 min)

### 1. Make the repo
Create a new GitHub repo named `watchman-digest` and put these three files in it:
`digest.mjs`, `README.md`, and `.github/workflows/digest.yml`.

### 2. Add the secrets
Repo → **Settings → Secrets and variables → Actions → New repository secret**.
Add these five. You paste them here yourself — they never go in the code:

| Secret | Value |
|---|---|
| `SUPABASE_URL` | Your project URL, e.g. `https://xxxxx.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → **service_role** key |
| `RESEND_API_KEY` | Resend → API Keys → the `watchman-digest` key (sending access) |
| `DIGEST_TO` | Where it lands — `aaron@notoriouslyfree.com` |
| `DIGEST_FROM` | Verified Resend sender — `mail@watchman.thealteredlife.org` |

> The `service_role` key bypasses row-level security so the job can read your
> tasks. It only ever lives in GitHub Actions secrets and Supabase — never in
> the frontend, never in chat.

### 3. Test it now — don't wait for 6 AM
Repo → **Actions → Watchman Digest → Run workflow**. A manual run always sends,
whatever time it is. Check your inbox. Check the run log if it doesn't arrive —
it prints exactly what failed (a missing secret, a Supabase read error, a Resend
rejection).

Once a real briefing lands the way you want it, you're done — the cron takes
over every morning.

## Changing things later

- **Different time:** in `.github/workflows/digest.yml`, both cron lines are UTC.
  For a new local hour, set `DIGEST_HOUR` as a repo secret (e.g. `7`) and shift
  the two cron hours to bracket it.
- **Different recipient / sender:** just edit the `DIGEST_TO` / `DIGEST_FROM`
  secrets. No code change.
- **Different timezone:** set a `DIGEST_TZ` secret (e.g. `America/New_York`).
