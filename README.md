# Briefer

Emails a daily agenda brief built from an ICS calendar feed. Runs as a
Vercel Cron job; sends via the Gmail API.

Each morning it lists today's events (time, location, attendees), all-day
items, and the open gaps in your schedule (8am–6pm Central by default), then
emails it as both plain text and HTML.

## How it's put together

- [`lib/ics.ts`](lib/ics.ts) — fetches and parses the ICS feed, expanding
  recurring events (including exceptions and moved/edited single instances)
  and returning everything that overlaps today in `America/Chicago`.
- [`lib/brief.ts`](lib/brief.ts) — turns those events into the email subject,
  plain-text body, and HTML body, including the free-time gap calculation.
- [`lib/email.ts`](lib/email.ts) — sends the brief through the Gmail API
  using a stored OAuth refresh token.
- [`lib/run.ts`](lib/run.ts) — ties the above together and decides (based on
  the current hour in `America/Chicago`) whether this invocation should
  actually send.
- [`api/daily-brief.ts`](api/daily-brief.ts) — the Vercel serverless function
  that Cron hits.
- [`vercel.json`](vercel.json) — schedules that function twice daily, at
  12:00 and 13:00 UTC. Only one of those two firings will match 7:00 AM
  Central on any given day — the other is a no-op — which is how the send
  time stays correct across the DST transition without needing a
  timezone-aware cron scheduler (Vercel Cron only speaks UTC).

## One-time setup

### 1. Get your calendar's private ICS URL

You said you already have this (e.g. Google Calendar's Settings →
"Integrate calendar" → **Secret address in iCal format**). Keep it secret —
anyone with the URL can read your calendar.

### 2. Create a Gmail API OAuth client

1. In the [Google Cloud Console](https://console.cloud.google.com/), create
   (or reuse) a project.
2. **APIs & Services → Library** — enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen** — set it up in Testing mode
   (External is fine); add `sai150306@gmail.com` as a test user.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**
   — Application type **Desktop app**. Note the generated Client ID and
   Client Secret.

### 3. Install dependencies and configure `.env`

```bash
npm install
cp .env.example .env
```

Fill in `.env`:
- `ICS_URL` — your private ICS feed URL
- `EMAIL_FROM` / `EMAIL_TO` — both `sai150306@gmail.com`
- `GMAIL_CLIENT_ID` / `GMAIL_CLIENT_SECRET` — from step 2

### 4. Get a Gmail refresh token (one-time, run locally)

```bash
npm run get-refresh-token
```

This opens a Google consent screen in your browser (sign in as
`sai150306@gmail.com`, grant the "send email" permission). It then prints a
`GMAIL_REFRESH_TOKEN` value — add it to `.env`.

### 5. Test locally before deploying

```bash
npm run brief:local            # prints today's brief to the console only
npm run brief:local -- --send  # also actually sends the email now
```

### 6. Deploy to Vercel

```bash
npm i -g vercel   # if you don't have it
vercel
```

Then, in the Vercel project's **Settings → Environment Variables**, add
every variable from `.env` (`ICS_URL`, `EMAIL_FROM`, `EMAIL_TO`,
`GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and
optionally `CRON_SECRET`/`SEND_HOUR_LOCAL`), then redeploy:

```bash
vercel --prod
```

Vercel will pick up `vercel.json` and register the two daily cron
invocations automatically.

### 7. (Recommended) Protect the endpoint

Set a `CRON_SECRET` env var (any random string). Vercel automatically sends
`Authorization: Bearer <CRON_SECRET>` on its own cron requests, and the
handler checks for that — so once it's set, nobody else can trigger your
endpoint or make it leak calendar contents via the JSON response. You can
still trigger it manually for testing:

```
https://<your-project>.vercel.app/api/daily-brief?force=true&secret=<CRON_SECRET>
```

## Notes

- The free-time window (8am–6pm Central) and 15-minute minimum-gap filter
  are constants at the top of `lib/brief.ts` — change `WINDOW_START_HOUR`
  and `WINDOW_END_HOUR` there if you want a different range.
- `SEND_HOUR_LOCAL` (default `7`) controls the local hour that counts as
  "the" send window in `lib/run.ts` — change it if you'd rather get the
  brief at a different hour, and update the two UTC entries in
  `vercel.json` to bracket it (target hour and target hour + 1, both in
  UTC, one for standard time and one for daylight time).
