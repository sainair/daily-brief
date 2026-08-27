/**
 * Local test runner. Loads .env, then either prints today's brief to the
 * console (default) or actually sends it via Gmail (--send).
 *
 * Usage:
 *   npm run brief:local            # print the brief, no email sent
 *   npm run brief:local -- --send  # also send the email now
 */
import "dotenv/config";
import { getEventsForDay, TIMEZONE } from "../lib/ics";
import { buildBrief } from "../lib/brief";
import { sendBriefEmail } from "../lib/email";

async function main() {
  const shouldSend = process.argv.includes("--send");
  const icsSource = requireEnv("ICS_URL");
  const now = new Date();

  console.log(`Fetching events for today (${TIMEZONE})...`);
  const events = await getEventsForDay(icsSource, now);
  const { subject, text } = buildBrief(events, now);

  console.log(`\nSubject: ${subject}\n`);
  console.log(text);

  if (shouldSend) {
    const fromAddr = requireEnv("EMAIL_FROM");
    const toAddr = requireEnv("EMAIL_TO");
    const { html } = buildBrief(events, now);
    await sendBriefEmail({ from: fromAddr, to: toAddr, subject, text, html });
    console.log(`\nSent to ${toAddr}.`);
  } else {
    console.log("\n(Dry run — pass --send to actually email this.)");
  }
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
