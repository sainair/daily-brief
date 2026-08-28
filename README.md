# Briefer

**Live:** [briefer-plum.vercel.app](https://briefer-plum.vercel.app) *(a placeholder page — the actual product is the email, not a UI)*

A daily agenda emailed straight from a calendar feed. No dashboard to check, no app to open — the schedule for today just shows up in your inbox every morning, built from the calendar you already use.

Built as a small, real automation project covering calendar/recurrence parsing, timezone-correct scheduling on a serverless platform, and OAuth-based email delivery — the kind of infrastructure that looks trivial until it has to survive a daylight-saving transition or a server in a different timezone than the one it was tested on.

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js, TypeScript |
| Calendar parsing | `node-ical`, `rrule` |
| Email delivery | Gmail API (`googleapis`), OAuth2 refresh token |
| Timezone handling | `date-fns` / `date-fns-tz` |
| Hosting | Vercel (serverless function + Cron) |
| Local tooling | `ts-node`, `dotenv` |

---

## AI-assisted development

Built end-to-end with **Claude Code** (Anthropic's agentic CLI), running on **Claude Sonnet 5**, used as the primary development tool rather than as an autocomplete layer inside an editor.

The integration was terminal-native: the agent had direct read/write access to the project directory and a real shell, so most work followed *edit → typecheck → run a script against a synthetic fixture → confirm the output → move on*, rather than describing a change and pasting it in by hand. Concretely, in this project that meant:

- **Scaffolding.** `package.json`, `tsconfig.json`, `vercel.json`, and the `lib/`/`api/`/`scripts/` modules were generated from a plain-language spec gathered through a short round of clarifying questions (ICS feed vs. Calendar API, Gmail API vs. SMTP, Node vs. another runtime, Vercel Cron vs. a different scheduler).
- **Catching a real production bug through disciplined local testing, not luck.** `node-ical`/`rrule`'s recurrence engine turned out to depend on the *server's* local timezone — invisible on the developer's own machine, which happened to share a timezone with the calendar under test, and only would have surfaced after deploying to Vercel's UTC runtime. It was caught before deploy by having the agent re-run the same fixture under several simulated server timezones (`TZ=UTC`, `America/Chicago`, `America/New_York`, `Asia/Tokyo`) in the same terminal session and diffing the results, instead of trusting a single passing local run.
- **Visual design iteration via live preview, not blind edits.** The email's HTML/CSS went through several rounds of redesign — including a full palette change and a from-scratch icon rework after a side-by-side comparison against a reference photo showed the first attempt didn't hold up — with each iteration published to a shareable live preview page and reviewed in an actual browser, rather than sending real test emails to check every change.
- **Dependency security review.** `npm audit` findings were traced back to their actual source packages instead of resolved with a blanket `npm audit fix --force`; a vulnerable dependency was pinned to a specific version chosen deliberately to avoid a breaking API change in a library the recurrence-parsing logic depends on.

Deploy and version-control actions — `git push`, `vercel --prod`, Google Cloud Console configuration — were deliberately kept manual throughout: the agent produced the exact commands and steps, but the developer ran them.

---

## Key features

**Recurrence-aware calendar parsing.** Expands `RRULE`-based recurring events, including exceptions (`EXDATE`) and single moved/edited instances (`RECURRENCE-ID` overrides), rather than only handling one-off events.

**Server-timezone-independent by design.** `node-ical`'s recurrence engine ties its own occurrence math to the *server's local timezone* — a bug that only surfaces when the server's clock doesn't match the calendar's, which local development will never catch by accident. Every date computation here works from explicit timezone conversions instead, and is validated by re-running the same fixtures under several simulated server timezones (UTC, Chicago, New York, Tokyo).

**DST-correct daily send with no timezone-aware scheduler.** Vercel Cron only speaks UTC, so the function is scheduled to fire twice a day, bracketing the target local hour across both standard and daylight time. The code itself checks the current hour in the target timezone and only one of the two firings ever actually sends.

**Skips quietly on empty days.** If there's nothing on the calendar for the day, no email goes out at all — no "you have nothing today" noise on a free Saturday.

**Dark, illustrated HTML email with a plain-text fallback.** A single committed dark-navy theme (not a light/dark toggle) so it renders identically regardless of the recipient's own mail client theme, plus a full plain-text version in the same MIME message for clients that don't render HTML.

**A protected trigger endpoint.** The Cron target is a plain HTTP endpoint, so it's guarded by a shared secret Vercel attaches automatically to its own requests — without it, anyone finding the URL could trigger a send or read calendar contents back in the response.

---

## Architecture

```
Vercel Cron                  api/daily-brief.ts                 External services
(12:00 & 13:00 UTC daily)    (serverless function)
      │                            │
      │  GET, Bearer CRON_SECRET   │
      ├───────────────────────────►│
      │                            │──── fetch ICS feed ───────► Calendar provider
      │                            │◄─────────────────────────── (private ICS URL)
      │                            │
      │                            │  lib/ics.ts   → parse + expand recurrence
      │                            │  lib/brief.ts → build subject/text/html
      │                            │  lib/run.ts   → decide: send or skip
      │                            │
      │                            │──── send (if not skipped) ─► Gmail API
      │                            │◄─────────────────────────── (OAuth refresh token)
      │                            │
      │◄─────── 200 JSON ──────────┤
```

The function never talks to a database — the ICS feed *is* the data source, fetched fresh on every invocation. Nothing about a day's brief is persisted between runs.

### Pipeline shape

```
getEventsForDay(icsUrl, date)  →  BriefEvent[]  →  buildBrief(events, date)  →  sendBriefEmail(...)
                                                     { subject, text, html }
```

```
BriefEvent
──────────
title
start, end     (real UTC instants — recurrence/DST already resolved)
allDay
location
attendees[]
```

`runDailyBrief()` in [`lib/run.ts`](lib/run.ts) is the only place these three steps are wired together, and it's the one both `api/daily-brief.ts` (production) and `scripts/run-local.ts --send` (local testing) call into — so a local test exercises the exact same send-or-skip logic that runs in Vercel, not a separate approximation of it.

---

## Running it

**Prerequisites:** Node.js, a private ICS calendar URL, a Gmail account you're willing to send from.

```bash
git clone https://github.com/sainair/daily-brief.git
cd daily-brief
npm install
cp .env.example .env
```

### 1. Get your calendar's private ICS URL

Google Calendar: Settings → the calendar → **Integrate calendar** → **Secret address in iCal format**. Keep it secret — anyone with the URL can read the calendar.

### 2. Create a Gmail API OAuth client

1. In the [Google Cloud Console](https://console.cloud.google.com/), create (or reuse) a project.
2. **APIs & Services → Library** — enable the **Gmail API**.
3. **APIs & Services → OAuth consent screen** — Testing mode is fine; add the sending Gmail account as a test user, and add the `gmail.send` scope under **Data Access**.
4. **Clients → Create Client** — Application type **Desktop app**. Note the Client ID and Secret.

### 3. Fill in `.env`

```
ICS_URL=<your private ICS feed URL>
EMAIL_FROM=<sending Gmail address>
EMAIL_TO=<recipient address>
GMAIL_CLIENT_ID=<from step 2>
GMAIL_CLIENT_SECRET=<from step 2>
GMAIL_REFRESH_TOKEN=<see step 4>
SEND_HOUR_LOCAL=7
CRON_SECRET=<any random string — see below>
```

### 4. Get a Gmail refresh token (one-time)

```bash
npm run get-refresh-token
```

Opens a Google consent screen locally; sign in as the sending account and grant the send permission. Prints a `GMAIL_REFRESH_TOKEN` value to put in `.env`.

### 5. Test locally

```bash
npm run brief:local                        # preview today's brief, no email sent
npm run brief:local -- --date=2026-08-29   # preview a specific date
npm run brief:local -- --send              # run the real send-or-skip logic
```

### 6. Deploy

```bash
npm i -g vercel
vercel
```

Add every variable from `.env` to the Vercel project's **Settings → Environment Variables** (Production scope — Vercel Cron only ever runs against Production), then:

```bash
vercel --prod
```

`vercel.json` registers the two daily Cron invocations automatically.

| Service | URL |
|---|---|
| App | [briefer-plum.vercel.app](https://briefer-plum.vercel.app) |
| Manual trigger | `https://<your-project>.vercel.app/api/daily-brief?force=true&secret=<CRON_SECRET>` |

`.env` is gitignored. `GMAIL_REFRESH_TOKEN` and `CRON_SECRET` both grant real access (sending mail as you, and triggering the endpoint) — they live in Vercel's environment variables, never in the repository.

---

## API

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/api/daily-brief` | `CRON_SECRET`, if set (`Authorization: Bearer <secret>` or `?secret=`) | Builds and sends today's brief, or skips if there are no events. `?force=true` bypasses the send-time-window check (not the empty-day skip). |

There's no other surface — no database, no user accounts, no additional routes.

---

## Design decisions

**Two daily Cron firings instead of one.** Vercel Cron schedules are UTC-only, so a single fixed schedule would drift an hour whenever daylight saving changes. Firing at both `12:00` and `13:00` UTC and letting the function itself check the current local hour keeps the send time correct year-round without an external timezone-aware scheduler.

**A plain (`tzid`-stripped) `RRule` rebuilt for recurrence expansion.** `node-ical`'s tzid-aware `RRule` instance ties its own `.between()` computation to the server's local timezone — a bug that only coincidentally produces correct results when the server and the calendar share a timezone, which is exactly what made it invisible during local development and only surfaced once deployed to Vercel's UTC runtime. Rebuilding the rule without `tzid`, using the already-correct floating `dtstart`, makes the expansion pure and environment-independent.

**All-day event boundaries re-derived from local `Date` getters.** For the same underlying reason — `node-ical` constructs date-only values via the server's local `Date` constructor — trusting the parsed instant directly meant an all-day item could shift by a server's UTC offset and, in the worst case, bleed onto the wrong calendar day entirely.

**Skip-if-empty, not skip-if-weekend.** The condition is "no events today," not "is it Saturday" — a quiet weekday holiday skips too, and a weekend with something actually on it still sends.

**One committed dark theme for the email, not an adaptive light/dark toggle.** Explicit colors that never depend on the recipient's mail client theme setting render predictably everywhere, which matters more here than matching every inbox's own appearance.

**An ICS feed, not a live Calendar API integration.** Avoids a second OAuth flow just to read events. The tradeoff is real-time-ness — the feed only refreshes on the calendar provider's own schedule — which is a fine trade for a once-a-day brief.

---

## Roadmap

**Near term**
- Multi-recipient support — sending the same or different briefs to more than one person (scoped in design discussion, not yet built: the current single `EMAIL_TO`/`ICS_URL` pair would need to become a list, and Vercel's Cron limits mean multiple send times/timezones would need either a Pro plan or an external scheduler)
- A required, rather than optional, `CRON_SECRET`

**Later**
- Self-serve calendar registration instead of manually editing environment variables and redeploying
- Per-recipient timezone and send-hour configuration

---

## Project structure

```
briefer/
├── api/
│   └── daily-brief.ts     # Vercel serverless function, Cron target
├── lib/
│   ├── ics.ts              # fetch + parse ICS, expand recurrence
│   ├── brief.ts             # build subject/text/html
│   ├── email.ts              # Gmail API send
│   └── run.ts                  # orchestration + send-or-skip decision
├── scripts/
│   ├── get-refresh-token.ts  # one-time Gmail OAuth setup
│   └── run-local.ts            # local preview / real-send testing
├── public/
│   └── index.html               # placeholder static page
├── vercel.json                     # Cron schedule
└── .env                              # not committed
```

---

## Notes

This is a personal automation tool, not a product — it has exactly one intended recipient today and no accounts, sessions, or stored data beyond what's already in the calendar feed itself. The Gmail OAuth client requests only the minimal `gmail.send` scope, and the refresh token it produces can send mail as the configured account but cannot read anything else in it.
