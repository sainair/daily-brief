import { toZonedTime } from "date-fns-tz";
import { getEventsForDay, TIMEZONE } from "./ics";
import { buildBrief } from "./brief";
import { sendBriefEmail } from "./email";

export interface RunResult {
  sent: boolean;
  reason?: string;
  subject?: string;
  eventCount?: number;
}

export async function runDailyBrief(opts: { force?: boolean; now?: Date } = {}): Promise<RunResult> {
  const now = opts.now ?? new Date();
  const targetHour = Number(process.env.SEND_HOUR_LOCAL ?? 7);

  if (!opts.force) {
    const localHour = toZonedTime(now, TIMEZONE).getHours();
    if (localHour !== targetHour) {
      return { sent: false, reason: `not send window (local hour ${localHour}, target ${targetHour})` };
    }
  }

  const icsSource = requireEnv("ICS_URL");
  const fromAddr = requireEnv("EMAIL_FROM");
  const toAddr = requireEnv("EMAIL_TO");

  const events = await getEventsForDay(icsSource, now);
  const { subject, text, html } = buildBrief(events, now);
  await sendBriefEmail({ from: fromAddr, to: toAddr, subject, text, html });

  return { sent: true, subject, eventCount: events.length };
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}
