/**
 * Local test runner. Loads .env, then either previews a day's brief
 * (default) or actually runs the real send-or-skip logic (--send).
 *
 * Usage:
 *   npm run brief:local                        # preview today, no email sent
 *   npm run brief:local -- --date=2026-08-29   # preview a specific date
 *   npm run brief:local -- --send              # run runDailyBrief for real (sends unless the day is empty)
 *   npm run brief:local -- --send --date=2026-08-29
 */
import "dotenv/config";
import { getEventsForDay, TIMEZONE } from "../lib/ics";
import { buildBrief } from "../lib/brief";
import { runDailyBrief } from "../lib/run";

function parseDate(): Date {
  const arg = process.argv.find((a) => a.startsWith("--date="));
  if (!arg) return new Date();
  const value = arg.slice("--date=".length);
  // Interpreted at noon UTC so it safely lands on the intended calendar day
  // in America/Chicago regardless of DST.
  const d = new Date(`${value}T12:00:00Z`);
  if (isNaN(d.getTime())) throw new Error(`Invalid --date value: ${value} (expected YYYY-MM-DD)`);
  return d;
}

async function main() {
  const shouldSend = process.argv.includes("--send");
  const now = parseDate();

  if (shouldSend) {
    console.log(`Running runDailyBrief for real (force: true, now: ${now.toISOString()})...`);
    const result = await runDailyBrief({ force: true, now });
    console.log(result);
    return;
  }

  const icsSource = requireEnv("ICS_URL");
  console.log(`Previewing brief for ${now.toDateString()} (${TIMEZONE})...\n`);
  const events = await getEventsForDay(icsSource, now);
  const { subject, text } = buildBrief(events, now);

  console.log(`Subject: ${subject}\n`);
  console.log(text);
  console.log(
    events.length === 0
      ? "\n(0 events — production would SKIP sending on this day.)"
      : "\n(Dry run — pass --send to actually run the real send-or-skip logic.)"
  );
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
